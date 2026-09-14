import { useState, useMemo, useCallback, useEffect, useRef, Fragment, type ReactNode } from "react";
import {
  Heading2,
  Heading3,
  Body,
  Muted,
  Text,
  Button,
  CopyButton,
  toast,
  AsciiSpinner,
  Input,
  Select,
  SegmentedTabs,
} from "@/components/ui";
import {
  useGetProviderInstalledPluginsQuery,
  useGetProviderPluginsQuery,
  useReadProviderPluginQuery,
  useInstallProviderPluginMutation,
  useUninstallProviderPluginMutation,
  useSetProviderPluginEnabledMutation,
  useUpdateProviderPluginMutation,
} from "@/lib/redux/api";
import type { PluginAppSummary, PluginInfo, PluginScope } from "@/lib/redux/api";
import { PROVIDER_IDS } from "../../../../shared/provider-ids";
import { getPluginInstallBlockReason } from "../../../../shared/plugin-install-availability";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import {
  Search,
  Check,
  Apps,
  Sparkles,
  External,
  Plus,
  ArrowUp,
  Close,
} from "@/components/ui/icons";

// ── Helpers ──

/** Format technical include names to human-readable titles.
 *  "github:gh-address-comments" → "Address Comments"
 *  "connector_76869538..." → "GitHub" (fallback to plugin name)
 *  "linear:linear" → "Linear"
 */
function formatIncludeName(raw: string): string {
  // Strip prefix like "github:", "linear:" etc.
  const afterColon = raw.includes(":") ? raw.split(":").pop()! : raw;
  // Strip common prefixes like "gh-", "asdk_app_", "connector_"
  let cleaned = afterColon
    .replace(/^(gh-|asdk_app_|connector_)[a-f0-9]{20,}$/i, "") // hash-only IDs → empty
    .replace(/^gh-/, "")
    .replace(/^asdk_app_.*$/, "")
    .replace(/^connector_.*$/, "");
  if (!cleaned) {
    // Fallback: use the part before ":"
    cleaned = raw.includes(":") ? raw.split(":")[0] : raw;
  }
  // Convert kebab-case to Title Case
  return cleaned
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Common acronyms to upper-case when humanizing slug-style plugin names. */
const PLUGIN_NAME_ACRONYMS = new Set([
  "ai", "api", "aws", "cli", "css", "db", "etl", "gcp", "html", "http", "id",
  "io", "js", "json", "jwt", "k8s", "llm", "mcp", "ml", "pdf", "sdk", "sql",
  "ssh", "ui", "ux", "url", "s3", "gpu", "cpu", "sso", "crm", "orm",
]);

/** "agent-sdk-dev" → "Agent SDK Dev". Used when a plugin has no displayName
 *  (Claude marketplace plugins are slug-named). Codex plugins keep their own
 *  displayName, so this only ever runs on the raw-name fallback. */
function humanizePluginName(raw: string): string {
  const words = raw
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase();
      if (PLUGIN_NAME_ACRONYMS.has(lower)) return lower.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    });
  return words.length ? words.join(" ") : raw;
}

/** "database" → "Database", "machine-learning" → "Machine Learning". */
function formatCategory(cat: string): string {
  return cat
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Compact install-count label: 940 → "940", 2293 → "2.3k", 948012 → "948k". */
function formatInstalls(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Deterministic avatar background for plugins without a brand color (e.g.
 *  Claude marketplace plugins, which publish no logo/brandColor). Same key →
 *  same hue, so the grid is colorful but stable. Dark enough for white text. */
function pluginAvatarColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 50% 45%)`;
}

function PluginLogo({
  plugin,
  size = "md",
}: {
  plugin: PluginInfo;
  size?: "sm" | "md" | "lg";
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const sizeClass =
    size === "lg" ? "size-14" : size === "md" ? "size-8" : "size-8";
  const roundedClass = size === "lg" ? "rounded-2xl" : "rounded-xl";
  const textSize =
    size === "lg" ? "text-xl" : size === "md" ? "text-sm" : "text-xs";
  const brandColor = plugin.interface?.brandColor;
  const logo = plugin.interface?.logo;
  const name = plugin.interface?.displayName || humanizePluginName(plugin.name);
  // No brand color (Claude plugins) → derive a stable color from the id so each
  // plugin gets a distinct avatar instead of an identical grey one.
  const generatedColor = brandColor ? null : pluginAvatarColor(plugin.id || plugin.name);

  if (logo && !logoFailed) {
    return (
      <img
        src={proxiedImageSrc(logo)}
        alt={name}
        loading="lazy"
        decoding="async"
        className={`${sizeClass} ${roundedClass} object-cover shrink-0`}
        onError={() => setLogoFailed(true)}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} ${roundedClass} flex items-center justify-center font-semibold ${textSize} text-primary shrink-0`}
      style={{ backgroundColor: brandColor || generatedColor || "var(--color-primary-500)" }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

/**
 * Horizontal scroll rail that fades content out at whichever edge still has
 * more to scroll. Uses a CSS mask instead of overlay gradients so it works on
 * any background (light/dark, glass) without color matching.
 */
function HorizontalFadeScroller({
  children,
  className = "",
  contentClassName = "flex gap-4 w-max",
}: {
  children: ReactNode;
  /** Outer (scrolling) element — for sizing it inside a flex row. */
  className?: string;
  contentClassName?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }));
  }, []);

  useEffect(() => {
    updateFade();
    const observer = new ResizeObserver(updateFade);
    if (scrollRef.current) observer.observe(scrollRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [updateFade]);

  const mask = `linear-gradient(to right, ${
    fade.left ? "transparent, black 3rem" : "black"
  }, ${fade.right ? "black calc(100% - 3rem), transparent" : "black"})`;

  return (
    <div
      ref={scrollRef}
      onScroll={updateFade}
      className={`overflow-x-auto noscrollbar snap-x  ${className}`}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      <div ref={contentRef} className={contentClassName}>
        {children}
      </div>
    </div>
  );
}

function InstalledPluginShelf({
  plugins,
  isLoading,
  onSelect,
}: {
  plugins: PluginInfo[];
  isLoading: boolean;
  onSelect: (pluginId: string) => void;
}) {
  if (!isLoading && plugins.length === 0) return null;

  return (
    <section className="mb-8" aria-label="Installed plugins">
      <Body weight="medium" className="mb-3">
        Installed
      </Body>
      <HorizontalFadeScroller contentClassName="flex gap-3 w-max px-0.5 pr-10">
        {isLoading
          ? Array.from({ length: 7 }, (_, index) => (
              <div
                key={index}
                className="size-12 shrink-0 rounded-2xl glass-surface animate-pulse"
                aria-hidden="true"
              />
            ))
          : plugins.map((plugin) => {
              const name =
                plugin.interface?.displayName ||
                humanizePluginName(plugin.name);
              return (
                <Button
                  key={plugin.id}
                  title={name}
                  aria-label={`Open ${name}`}
                  onClick={() => onSelect(plugin.id)}
                  className={`size-12 shrink-0 snap-start rounded-2xl glass-surface flex items-center justify-center transition-[transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 cursor-pointer ${
                    plugin.enabled ? "" : "opacity-55"
                  }`}
                >
                  <PluginLogo plugin={plugin} size="md" />
                </Button>
              );
            })}
      </HorizontalFadeScroller>
    </section>
  );
}

/** Group plugin apps by marketplace category, preserving first-seen order. */
function groupAppsByCategory(
  apps: PluginAppSummary[],
): Array<{ category: string | null; apps: PluginAppSummary[] }> {
  const groups: Array<{ category: string | null; apps: PluginAppSummary[] }> = [];
  const indexByCategory = new Map<string, number>();
  for (const app of apps) {
    const category = app.category ?? null;
    const key = category ?? "";
    let i = indexByCategory.get(key);
    if (i === undefined) {
      i = groups.length;
      indexByCategory.set(key, i);
      groups.push({ category, apps: [] });
    }
    groups[i].apps.push(app);
  }
  return groups;
}

/** App logo from the connector directory; falls back to the generic Apps icon. */
function AppIncludeIcon({ app }: { app: PluginAppSummary }) {
  const [failed, setFailed] = useState(false);
  if (app.iconUrl && !failed) {
    return (
      <img
        src={proxiedImageSrc(app.iconUrl)}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-7 rounded-lg object-cover shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="size-7 rounded-lg bg-primary-200/50 dark:bg-primary-700/30 flex items-center justify-center shrink-0">
      <Apps className="size-4 text-primary-800 dark:text-primary" />
    </div>
  );
}

// ── Plugin Card (Connection-style) ──

function PluginCard({
  plugin,
  onSelect,
  onInstall,
  onUninstall,
  isInstalling,
  compact = false,
}: {
  plugin: PluginInfo;
  onSelect: () => void;
  onInstall: () => void;
  onUninstall: () => void;
  isInstalling: boolean;
  /** Tighter padding + smaller controls, for the featured rail. */
  compact?: boolean;
}) {
  const name = plugin.interface?.displayName || humanizePluginName(plugin.name);
  const description = plugin.interface?.shortDescription || "";
  const installBlockReason = plugin.installed
    ? null
    : getPluginInstallBlockReason(plugin);

  return (
    <div
      className={`glass-surface cursor-pointer rounded-3xl transition-colors flex items-center gap-3 ${
        compact ? "px-4 py-4" : " px-4 py-6"
      }`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect();
      }}
    >
      <PluginLogo plugin={plugin} size="md" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Text as="span" weight="medium" className="truncate">
            {name}
          </Text>
          {plugin.installed && !plugin.enabled && (
            <Text
              as="span"
              size="t"
              tone="subtle"
              className="shrink-0 px-1.5 py-0.5 rounded-full bg-primary-200/60 dark:bg-primary-800/40"
            >
              Disabled
            </Text>
          )}
          {plugin.updateAvailable && (
            <Text
              as="span"
              size="t"
              tone="warning"
              className="shrink-0 px-1.5 py-0.5 rounded-full bg-warning/15"
            >
              Update
            </Text>
          )}
          {installBlockReason && (
            <Text
              as="span"
              size="t"
              tone="warning"
              className="shrink-0 px-1.5 py-0.5 rounded-full bg-warning/15"
            >
              Unavailable
            </Text>
          )}
        </div>
        <Text
          as="div"
          size="xs"
          tone="subtle"
          className="flex items-center gap-2 min-w-0"
        >
          <span className="truncate">{description}</span>
          {typeof plugin.installs === "number" && plugin.installs > 0 && (
            <span className="shrink-0 tabular-nums opacity-70">
              {formatInstalls(plugin.installs)} installs
            </span>
          )}
        </Text>
      </div>
      <Button
        type="button"
        className={`shrink-0 ${compact ? "size-7" : "size-8"} flex items-center justify-center rounded-full text-lg transition-colors cursor-pointer ${
          plugin.installed
            ? "bg-success/15 text-success"
            : "bg-primary-200/60 dark:bg-primary-800/20 text-primary-600 dark:text-primary-400 hover:bg-primary-300/60 dark:hover:bg-primary-700/30"
        }`}
        onClick={(e) => {
          e.stopPropagation();
          if (plugin.installed) {
            onUninstall();
          } else {
            onInstall();
          }
        }}
        disabled={isInstalling || Boolean(installBlockReason)}
        title={installBlockReason ?? undefined}
      >
        {isInstalling ? (
          <div className="mb-1 px-1.5">
            <AsciiSpinner variant="null" />
          </div>
        ) : plugin.installed ? (
          <Check className="size-4" />
        ) : (
          <Plus className="size-4" />
        )}
      </Button>
    </div>
  );
}

// ── Plugin Detail ──

function PluginDetail({
  plugin,
  providerId,
  marketplacePath,
  onBack,
  onInstall,
  onUninstall,
  onToggleEnabled,
  onUpdate,
  installScope,
  onScopeChange,
  isInstalling,
  isToggling,
  isUpdating,
}: {
  plugin: PluginInfo;
  providerId: string;
  marketplacePath: string;
  onBack: () => void;
  onInstall: () => void;
  onUninstall: () => void;
  onToggleEnabled: () => void;
  onUpdate: () => void;
  installScope: PluginScope;
  onScopeChange: (scope: PluginScope) => void;
  isInstalling: boolean;
  isToggling: boolean;
  isUpdating: boolean;
}) {
  const iface = plugin.interface;
  const name = iface?.displayName || humanizePluginName(plugin.name);
  const pluginName = plugin.name || plugin.id.split("@")[0];
  // Scope only applies to Claude's CLI install; Codex has no scope concept.
  const supportsScope = providerId === PROVIDER_IDS.claude;
  // Codex remote-catalog plugins have no plugin-level enable/disable — their
  // enabled state lives server-side and the config flag is ignored. Only
  // install/uninstall applies.
  const supportsEnableToggle = plugin.source?.type !== "remote";

  // Remote-catalog plugins have no marketplace path — the codex driver resolves
  // them by backend id, so an empty path is fine to send.
  const { data: detail } = useReadProviderPluginQuery(
    { providerId, pluginName, marketplacePath },
    { skip: !pluginName },
  );
  const hasIncludes =
    detail &&
    (detail.skills.length > 0 ||
      detail.apps.length > 0 ||
      detail.mcpServers.length > 0);

  // The detail read carries marketplace.json fallback fields (developer,
  // category, website) that the list payload lacks — prefer it for the
  // Information table. The header keeps using the list `iface` (its
  // displayName is the humanized one).
  const info = detail?.summary.interface ?? iface;
  const normalizeRepoUrl = (u?: string | null) =>
    (u ?? "").replace(/\.git$/, "").replace(/\/+$/, "");
  // Source repo link — only when it's a real URL that isn't just the website.
  const rawSourcePath = plugin.source?.path ?? "";
  const sourceUrl =
    /^https?:\/\//.test(rawSourcePath) &&
    normalizeRepoUrl(rawSourcePath) !== normalizeRepoUrl(info?.websiteUrl)
      ? rawSourcePath
      : undefined;
  const installCount = plugin.installs ?? detail?.uniqueInstalls ?? null;
  const lastUpdated = detail?.lastUpdated ?? null;
  const installedAt = plugin.installedAt ?? detail?.summary.installedAt ?? null;
  const installBlockReason = plugin.installed
    ? null
    : getPluginInstallBlockReason(plugin) ??
      (detail?.summary
        ? getPluginInstallBlockReason(detail.summary)
        : null);
  const hasInformation = !!(
    info?.category ||
    info?.developerName ||
    info?.websiteUrl ||
    info?.privacyPolicyUrl ||
    info?.termsOfServiceUrl ||
    sourceUrl ||
    installCount != null ||
    installedAt != null ||
    lastUpdated
  );

  return (
    <div className="mb-12">
      <Button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-900 dark:hover:text-primary-100 mb-6 cursor-pointer"
      >
        <ArrowUp className="size-4 rotate-270 -ml-1" />
        Back to plugins
      </Button>

      <div className="flex items-start gap-4 mb-6">
        <PluginLogo plugin={plugin} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-4">
            <Heading2>{name}</Heading2>
            <div className="flex items-center gap-2 shrink-0">
              {!plugin.installed ? (
                <>
                  {supportsScope && (
                    <Select<PluginScope>
                      value={installScope}
                      aria-label="Plugin install scope"
                      onChange={onScopeChange}
                      title="Select Scope"
                      options={[
                        { value: "user", label: "User", description: "Global (all projects)" },
                        { value: "project", label: "Project", description: "This project (shared)" },
                        { value: "local", label: "Local", description: "This project (private)" },
                      ]}
                    />
                  )}
                  <Button
                    onClick={onInstall}
                    disabled={isInstalling || Boolean(installBlockReason)}
                    title={installBlockReason ?? undefined}
                    variant="primary"
                  >
                    {isInstalling ? (
                      <div className="px-1.5">
                        <AsciiSpinner variant="null" />
                      </div>
                    ) : (
                      "Add"
                    )}
                  </Button>
                </>
              ) : (
                <>
                  {plugin.updateAvailable && (
                    <Button onClick={onUpdate} disabled={isUpdating} variant="primary">
                      {isUpdating ? (
                        <div className="px-1.5">
                          <AsciiSpinner variant="null" />
                        </div>
                      ) : (
                        "Update"
                      )}
                    </Button>
                  )}
                  {supportsEnableToggle && (
                    <Button onClick={onToggleEnabled} disabled={isToggling} variant="secondary">
                      {isToggling ? (
                        <div className="px-1.5">
                          <AsciiSpinner variant="null" />
                        </div>
                      ) : plugin.enabled ? (
                        "Disable"
                      ) : (
                        "Enable"
                      )}
                    </Button>
                  )}
                  <Button onClick={onUninstall} disabled={isInstalling} variant="secondary">
                    {isInstalling ? (
                      <div className="px-1.5">
                        <AsciiSpinner variant="null" />
                      </div>
                    ) : (
                      "Uninstall"
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
          {installBlockReason && (
            <Text as="div" size="xs" tone="warning" className="mt-2">
              {installBlockReason}
            </Text>
          )}
        </div>
      </div>

      {/* Screenshots */}
      {/* {iface?.screenshots && iface.screenshots.length > 0 && (
        <div className="mb-6 overflow-x-auto flex gap-3 pb-2">
          {iface.screenshots.map((src, i) => (
            <img
              key={i}
              src={proxiedImageSrc(src)}
              alt={`${name} screenshot ${i + 1}`}
              loading="lazy"
              decoding="async"
              className="h-48 rounded-xl object-cover"
            />
          ))}
        </div>
      )} */}

      {/* Long description */}
      {(detail?.description || iface?.longDescription) && (
        <div className="mb-8">
          <Body className="whitespace-pre-wrap">
            {detail?.description || iface?.longDescription}
          </Body>
        </div>
      )}

      {/* Includes (skills, apps, MCP servers) */}
      {hasIncludes && (
        <div className="mb-8">
          <Heading3 className="mb-3">Includes</Heading3>
          <div className="rounded-xl border border-primary-200/60 dark:border-primary-800/20 divide-y divide-primary-200/60 dark:divide-primary-800/20">
            {groupAppsByCategory(detail.apps).map(({ category, apps: categoryApps }) => (
              <Fragment key={category ?? "uncategorized"}>
                {category && (
                  <Text
                    as="div"
                    size="xs"
                    tone="subtle"
                    weight="medium"
                    className="px-4 pt-2.5 pb-1"
                  >
                    {category}
                  </Text>
                )}
                {categoryApps.map((app) => (
                  <div key={app.id} className="flex items-center gap-3 px-4 py-3">
                    <AppIncludeIcon app={app} />
                    <div className="flex-1 min-w-0">
                      <IncludeText
                        name={app.name || name}
                        kind="App"
                        description={app.description}
                      />
                    </div>
                {app.isEnabled === false ? (
                  <Text
                    as="span"
                    size="xs"
                    tone="subtle"
                    className="shrink-0 px-2 py-0.5 rounded-full bg-primary-200/60 dark:bg-primary-800/20"
                  >
                    Disabled
                  </Text>
                ) : app.isAccessible === true ? (
                  <Text
                    as="span"
                    size="xs"
                    tone="success"
                    className="shrink-0 px-2 py-0.5 rounded-full bg-success/15"
                  >
                    Connected
                  </Text>
                ) : app.installUrl ? (
                  <Button
                    variant="icon"
                    className="shrink-0 rounded-lg"
                    onClick={() =>
                      window.api.shell.openExternal(app.installUrl!)
                    }
                  >
                    <External className="size-4" />
                  </Button>
                ) : null}
                  </div>
                ))}
              </Fragment>
            ))}
            {detail.skills.map((skill) => (
              <div
                key={skill.name}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="size-7 rounded-lg bg-primary-200/50 dark:bg-primary-700/30 flex items-center justify-center shrink-0">
                  <Sparkles className="size-4 text-primary-800 dark:text-primary" />
                </div>
                <div className="min-w-0">
                  <IncludeText
                    name={skill.displayName || formatIncludeName(skill.name)}
                    kind="Skill"
                    description={skill.shortDescription || skill.description}
                  />
                </div>
              </div>
            ))}
            {detail.mcpServers.map((server) => (
              <div key={server} className="flex items-center gap-3 px-4 py-3">
                <div className="size-8 rounded-lg bg-primary-200/50 dark:bg-primary-700/30 flex items-center justify-center shrink-0">
                  <Text as="span" size="xs" tone="subtle">
                    MCP
                  </Text>
                </div>
                <div className="min-w-0">
                  <IncludeText name={server} kind="MCP Server" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Capabilities */}
      {iface?.capabilities && iface.capabilities.length > 0 && (
        <div className="mb-8">
          <Heading3 className="mb-3">Capabilities</Heading3>
          <div className="flex flex-wrap gap-2">
            {iface.capabilities.map((cap) => (
              <Text
                key={cap}
                as="span"
                size="xs"
                tone="muted"
                weight="medium"
                className="px-3 py-1 rounded-full bg-primary-200/50 dark:bg-primary-700/30"
              >
                {cap}
              </Text>
            ))}
          </div>
        </div>
      )}

      {/* Starter prompts */}
      {iface?.defaultPrompt && iface.defaultPrompt.length > 0 && (
        <div className="mb-8">
          <Heading3 className="mb-3">Starter Prompts</Heading3>
          <div className="space-y-2">
            {iface.defaultPrompt.map((prompt, i) => (
              <PromptRow key={i} prompt={prompt} />
            ))}
          </div>
        </div>
      )}

      {/* Information table — hidden entirely when no row has data */}
      {hasInformation && (
        <>
          <Heading3 className="mb-3">Information</Heading3>
          <div className="rounded-xl border border-primary-200/60 dark:border-primary-800/20 divide-y divide-primary-200/60 dark:divide-primary-800/20">
            {info?.category && <InfoRow label="Category" value={info.category} />}
            {info?.developerName && (
              <InfoRow label="Developer" value={info.developerName} />
            )}
            {installCount != null && (
              <InfoRow
                label="Installs"
                value={installCount.toLocaleString("en-US")}
              />
            )}
            {lastUpdated && (
              <InfoRow
                label="Updated"
                value={new Date(lastUpdated).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              />
            )}
            {installedAt != null && (
              <InfoRow
                label="Installed"
                value={new Date(installedAt * 1000).toLocaleDateString(
                  "en-US",
                  {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  },
                )}
              />
            )}
            {info?.websiteUrl && (
              <InfoRow
                label="Website"
                value={<ExternalLinkValue url={info.websiteUrl} />}
              />
            )}
            {sourceUrl && (
              <InfoRow
                label="Source"
                value={<ExternalLinkValue url={sourceUrl} />}
              />
            )}
            {info?.privacyPolicyUrl && (
              <InfoRow
                label="Privacy Policy"
                value={<ExternalLinkValue url={info.privacyPolicyUrl} label="View" />}
              />
            )}
            {info?.termsOfServiceUrl && (
              <InfoRow
                label="Terms of Service"
                value={<ExternalLinkValue url={info.termsOfServiceUrl} label="View" />}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** External link rendered as its hostname (or a fixed label), opened via window.open. */
function ExternalLinkValue({ url, label }: { url: string; label?: string }) {
  let text = label;
  if (!text) {
    try {
      text = new URL(url).hostname;
    } catch {
      text = url;
    }
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent hover:underline"
      onClick={(e) => {
        e.preventDefault();
        window.open(url, "_blank");
      }}
    >
      {text}
    </a>
  );
}

/**
 * One entry in a plugin's "Includes" list. Apps, skills, and MCP servers each
 * rendered this by hand; the name, its kind, and the description are one
 * typographic decision, not three.
 */
function IncludeText({
  name,
  kind,
  description,
}: {
  name: string;
  kind: string;
  description?: string | null;
}) {
  return (
    <>
      <Text as="div" weight="medium">
        {name}{" "}
        <Text as="span" size="xs" tone="subtle" weight="normal" className="ml-1">
          {kind}
        </Text>
      </Text>
      {description && (
        <Text as="div" size="xs" tone="subtle" className="truncate">
          {description}
        </Text>
      )}
    </>
  );
}

function PromptRow({ prompt }: { prompt: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-100/50 dark:bg-primary-800/30 group">
      <Text as="span" tone="muted" className="flex-1">
        {prompt}
      </Text>
      <CopyButton
        text={prompt}
        tooltip="Copy"
        copiedTooltip="Copied!"
        variant="bare"
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
      />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <Text as="span" tone="subtle">
        {label}
      </Text>
      <Text as="span" weight="medium">
        {value}
      </Text>
    </div>
  );
}

const FEATURED_PLUGIN_NAMES = [
  "github",
  "slack",
  "notion",
  "linear",
  "gmail",
  "google-calendar",
  "google-drive",
  "figma",
  "chrome",
  "computer-use"
];

// ── Main Component ──

export default function ProviderPlugins({
  providerId = PROVIDER_IDS.codex,
}: {
  providerId?: string;
} = {}) {
  const {
    data: pluginData,
    isLoading,
    error,
  } = useGetProviderPluginsQuery(providerId, {
    refetchOnFocus: false,
    refetchOnReconnect: false,
  });
  const isCodex = providerId === PROVIDER_IDS.codex;
  const {
    data: installedPluginData,
    isLoading: isLoadingInstalledPlugins,
  } = useGetProviderInstalledPluginsQuery(providerId, {
    skip: !isCodex,
    refetchOnFocus: false,
    refetchOnReconnect: false,
  });
  const [installPlugin, { isLoading: isInstalling }] =
    useInstallProviderPluginMutation();
  const [uninstallPlugin, { isLoading: isUninstalling }] =
    useUninstallProviderPluginMutation();
  const [setPluginEnabled, { isLoading: isToggling }] =
    useSetProviderPluginEnabledMutation();
  const [updatePlugin, { isLoading: isUpdating }] =
    useUpdateProviderPluginMutation();

  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [installScope, setInstallScope] = useState<PluginScope>("user");

  // Flatten all plugins from all marketplaces (only OpenAI plugins for now)
  const allPlugins = useMemo(() => {
    if (!pluginData) return [];
    return pluginData.marketplaces.flatMap((mp) => mp.plugins);
    //.filter((p) => p.interface?.developerName === "OpenAI" || p.interface?.developerName === "Vercel Labs" );
  }, [pluginData]);

  const installedPlugins = useMemo(() => {
    if (isCodex) {
      return (
        installedPluginData?.marketplaces.flatMap(
          (marketplace) => marketplace.plugins,
        ) ?? []
      );
    }
    return allPlugins.filter((plugin) => plugin.installed);
  }, [allPlugins, installedPluginData, isCodex]);

  // id → rank; the marketplace's featuredPluginIds order is a curated ranking,
  // so keep it instead of falling back to marketplace order.
  const featuredRank = useMemo(() => {
    const rank = new Map<string, number>();
    const fromApi = pluginData?.featuredPluginIds ?? [];
    if (fromApi.length > 0) {
      fromApi.forEach((id, i) => rank.set(id, i));
      return rank;
    }
    for (const p of allPlugins) {
      const name = p.name || p.id.split("@")[0];
      const i = FEATURED_PLUGIN_NAMES.indexOf(name);
      if (i !== -1) rank.set(p.id, i);
    }
    return rank;
  }, [pluginData, allPlugins]);

  // Unique categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of allPlugins) {
      if (p.interface?.category) cats.add(p.interface.category);
    }
    return Array.from(cats).sort();
  }, [allPlugins]);

  // "All" rides on the empty string: a category is only ever a non-empty
  // name (see the Set above), so it can't collide with a real one.
  const categoryOptions = useMemo(
    () => [
      { value: "", label: "All" },
      ...categories.map((cat) => ({ value: cat, label: formatCategory(cat) })),
    ],
    [categories],
  );

  // Filter plugins
  const filteredPlugins = useMemo(() => {
    let result = allPlugins;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.interface?.displayName?.toLowerCase().includes(q) ||
          p.interface?.shortDescription?.toLowerCase().includes(q) ||
          p.interface?.developerName?.toLowerCase().includes(q),
      );
    }
    if (categoryFilter) {
      result = result.filter((p) => p.interface?.category === categoryFilter);
    }
    return result;
  }, [allPlugins, search, categoryFilter]);

  // Highlight row: curated "Featured" when the marketplace provides it, else
  // fall back to the most-installed plugins ("Popular") — useful for Claude,
  // which has no featured list but does report install counts.
  const featured = useMemo(
    () =>
      filteredPlugins
        .filter((p) => featuredRank.has(p.id))
        .sort((a, b) => featuredRank.get(a.id)! - featuredRank.get(b.id)!),
    [filteredPlugins, featuredRank],
  );
  const popular = useMemo(() => {
    if (featuredRank.size > 0) return [];
    return [...filteredPlugins]
      .filter((p) => (p.installs ?? 0) > 0)
      .sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0))
      .slice(0, 6);
  }, [filteredPlugins, featuredRank]);
  const highlight = featured.length ? featured : popular;
  const highlightLabel = featured.length ? "Featured" : "Popular";
  const highlightIds = useMemo(() => new Set(highlight.map((p) => p.id)), [highlight]);

  const grouped = useMemo(() => {
    const groups = new Map<string, PluginInfo[]>();
    for (const p of filteredPlugins) {
      if (highlightIds.has(p.id) && !categoryFilter) continue;
      const cat = p.interface?.category || "Other";
      const list = groups.get(cat) ?? [];
      list.push(p);
      groups.set(cat, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredPlugins, highlightIds, categoryFilter]);

  const selectedPlugin = useMemo(
    () => allPlugins.find((p) => p.id === selectedPluginId) ?? null,
    [allPlugins, selectedPluginId],
  );

  // Find marketplace path for the selected plugin
  const selectedPluginMarketplacePath = useMemo(() => {
    if (!selectedPluginId || !pluginData) return "";
    for (const mp of pluginData.marketplaces) {
      // Remote marketplaces report a null path — normalize so the read query
      // still fires and the driver can resolve the plugin by backend id.
      if (mp.plugins.some((p) => p.id === selectedPluginId)) return mp.path ?? "";
    }
    return "";
  }, [selectedPluginId, pluginData]);

  const [actionInFlight, setActionInFlight] = useState<string | null>(null);

  const handleInstall = useCallback(
    async (pluginId: string) => {
      setActionInFlight(pluginId);
      try {
        await installPlugin({ providerId, pluginId, scope: installScope }).unwrap();
        toast.success("Plugin installed");
      } catch (err: any) {
        toast.error(extractErrorMessage(err, "Failed to install plugin"));
      } finally {
        setActionInFlight(null);
      }
    },
    [installPlugin, providerId, installScope],
  );

  const handleUninstall = useCallback(
    async (pluginId: string) => {
      setActionInFlight(pluginId);
      try {
        await uninstallPlugin({ providerId, pluginId }).unwrap();
        toast.success("Plugin uninstalled");
      } catch (err: any) {
        toast.error(extractErrorMessage(err, "Failed to uninstall plugin"));
      } finally {
        setActionInFlight(null);
      }
    },
    [uninstallPlugin, providerId],
  );

  const handleToggleEnabled = useCallback(
    async (pluginId: string, enabled: boolean) => {
      setActionInFlight(pluginId);
      try {
        await setPluginEnabled({ providerId, pluginId, enabled }).unwrap();
        toast.success(enabled ? "Plugin enabled" : "Plugin disabled");
      } catch (err: any) {
        toast.error(extractErrorMessage(err, "Failed to update plugin"));
      } finally {
        setActionInFlight(null);
      }
    },
    [setPluginEnabled, providerId],
  );

  const handleUpdate = useCallback(
    async (pluginId: string) => {
      setActionInFlight(pluginId);
      try {
        await updatePlugin({ providerId, pluginId }).unwrap();
        toast.success("Plugin updated");
      } catch (err: any) {
        toast.error(extractErrorMessage(err, "Failed to update plugin"));
      } finally {
        setActionInFlight(null);
      }
    },
    [updatePlugin, providerId],
  );

  if (isLoading) {
    return (
      <div className="mb-12">
        <InstalledPluginShelf
          plugins={installedPlugins}
          isLoading={isCodex ? isLoadingInstalledPlugins : true}
          onSelect={setSelectedPluginId}
        />
        <Muted>Loading plugins... This may take a moment on first load.</Muted>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-12">
        <InstalledPluginShelf
          plugins={installedPlugins}
          isLoading={isCodex && isLoadingInstalledPlugins}
          onSelect={setSelectedPluginId}
        />
        <Muted>Failed to load plugins: {extractErrorMessage(error, "Unknown error")}</Muted>
      </div>
    );
  }

  // Detail view
  if (selectedPlugin) {
    return (
      <PluginDetail
        plugin={selectedPlugin}
        providerId={providerId}
        marketplacePath={selectedPluginMarketplacePath}
        onBack={() => setSelectedPluginId(null)}
        onInstall={() => handleInstall(selectedPlugin.id)}
        onUninstall={() => handleUninstall(selectedPlugin.id)}
        onToggleEnabled={() => handleToggleEnabled(selectedPlugin.id, !selectedPlugin.enabled)}
        onUpdate={() => handleUpdate(selectedPlugin.id)}
        installScope={installScope}
        onScopeChange={setInstallScope}
        isInstalling={
          (isInstalling || isUninstalling) &&
          actionInFlight === selectedPlugin.id
        }
        isToggling={isToggling && actionInFlight === selectedPlugin.id}
        isUpdating={isUpdating && actionInFlight === selectedPlugin.id}
      />
    );
  }

  // List view
  return (
    <div className="mb-12">
      <InstalledPluginShelf
        plugins={installedPlugins}
        isLoading={isCodex && isLoadingInstalledPlugins}
        onSelect={setSelectedPluginId}
      />

      {/* Category filter + search */}
      <div className="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:justify-between md:gap-4">
        <HorizontalFadeScroller
          className="min-w-0 flex-1"
          contentClassName="w-max"
        >
          <SegmentedTabs
            value={categoryFilter ?? ""}
            onChange={(next) => setCategoryFilter(next || null)}
            options={categoryOptions}
            variant="plain"
            semantics="radiogroup"
            aria-label="Plugin category"
          />
        </HorizontalFadeScroller>
        <div className="relative w-full md:w-56 md:shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-primary-600 dark:text-primary-400 pointer-events-none" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Escape clears the filter rather than bubbling out of the page.
              if (e.key === "Escape" && search) {
                e.preventDefault();
                e.stopPropagation();
                setSearch("");
              }
            }}
            placeholder="Search plugins..."
            aria-label="Search plugins"
            className={`pl-8 py-1.5 ${search ? "pr-8" : ""}`}
          />
          {search && (
            <Button
              onClick={() => setSearch("")}
              title="Clear search"
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-primary-600 hover:bg-primary/20 hover:text-primary-800 dark:text-primary-400 dark:hover:bg-primary/10 dark:hover:text-primary-200"
            >
              <Close className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Featured / Popular — horizontal rail in curated order */}
      {highlight.length > 0 && !categoryFilter && (
        <div className="my-12">
          <Body weight="medium" className="mb-3">
            {highlightLabel}
          </Body>
          <HorizontalFadeScroller contentClassName="grid grid-rows-2 grid-flow-col gap-3 w-max">
            {highlight.map((p) => (
              <div key={p.id} className="w-72 snap-start">
                <PluginCard
                  compact
                  plugin={p}
                  onSelect={() => setSelectedPluginId(p.id)}
                  onInstall={() => handleInstall(p.id)}
                  onUninstall={() => handleUninstall(p.id)}
                  isInstalling={
                    (isInstalling || isUninstalling) && actionInFlight === p.id
                  }
                />
              </div>
            ))}
          </HorizontalFadeScroller>
        </div>
      )}

      {/* Grouped by category */}
      {grouped.map(([category, plugins]) => (
        <div key={category} className="mb-12">
          <Body weight="medium" className="mb-3">
            {formatCategory(category)}
          </Body>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-8">
            {plugins.map((p) => (
              <PluginCard
                key={p.id}
                plugin={p}
                onSelect={() => setSelectedPluginId(p.id)}
                onInstall={() => handleInstall(p.id)}
                onUninstall={() => handleUninstall(p.id)}
                isInstalling={
                  (isInstalling || isUninstalling) && actionInFlight === p.id
                }
              />
            ))}
          </div>
        </div>
      ))}

      {filteredPlugins.length === 0 && (
        <div className="text-center py-12">
          <Muted>No plugins found</Muted>
        </div>
      )}
    </div>
  );
}
