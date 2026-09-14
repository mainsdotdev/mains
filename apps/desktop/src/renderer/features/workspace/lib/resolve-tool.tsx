import { Mcp } from "@/components/ui/icons";
import {
  BUILTIN_TOOLS,
  DEFAULT_VERBS,
  VENDORS,
  type BuiltinTool,
  type VendorInfo,
  type VerbInfo,
} from "./tool-registry";

export interface ResolvedTool {
  /** Human-readable label shown in the UI ("Linear listed issues", "Bash"). */
  displayName: string;
  /**
   * Stable comparison key used by `groupConsecutiveToolCalls` to decide
   * whether two events belong in the same sub-group. Built-ins use the
   * canonical lowercase tool name (`bash`, `read`); MCP tools use
   * `vendorId:verb` (`linear:list`) so distinct verbs stay separate.
   */
  groupKey: string;
  /** Label shown when several events with the same groupKey are collapsed. */
  groupLabel: string;
  category: string;
  icon: React.ReactNode;
  /** Defined for MCP tools that route through `McpDisplay`. */
  vendorId?: string;
  /** Verb extracted from the MCP tool name (e.g. "list"). */
  verb?: string;
  /** Entity extracted from the MCP tool name (e.g. "issues"). */
  entity?: string;
  /** True for tools that should always start a fresh group (Task, TaskCreate/TaskUpdate). */
  isSpecialGroup: boolean;
  /** True when this tool resolved to a built-in entry. */
  isBuiltin: boolean;
}

/**
 * Pull the bare tool name from a RunEvent `content` string. Events arrive as
 * `"toolName: {json}"` or just `"toolName"`.
 */
function extractToolName(content: string): string {
  const colonIdx = content.indexOf(":");
  return (colonIdx > 0 ? content.substring(0, colonIdx) : content).trim();
}

function findBuiltin(lower: string): BuiltinTool | null {
  for (const t of BUILTIN_TOOLS) {
    if (t.aliases.includes(lower)) return t;
  }
  // Loose fallback — useful for variants like `agent_read`, `bash_exec`. We
  // only allow contains-matching for short, distinctive aliases to avoid
  // false positives (e.g. "search" matching inside "research").
  for (const t of BUILTIN_TOOLS) {
    for (const alias of t.aliases) {
      if (alias.length >= 4 && lower.includes(alias)) return t;
    }
  }
  return null;
}

function findVendor(lower: string): { vendor: VendorInfo; rest: string } | null {
  for (const vendor of VENDORS) {
    for (const prefix of vendor.prefixes) {
      if (lower.startsWith(prefix)) {
        return { vendor, rest: lower.slice(prefix.length) };
      }
    }
  }
  return null;
}

function snakeToWords(s: string): string {
  return s.replace(/_/g, " ").trim();
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function getVerbInfo(vendor: VendorInfo, verb: string): VerbInfo | undefined {
  return vendor.verbs?.[verb] ?? DEFAULT_VERBS[verb];
}

function resolveVendorTool(vendor: VendorInfo, rest: string): ResolvedTool {
  // Strip a leading `_` left over after a vendor prefix that doesn't end in
  // one (e.g. prefix `mcp__codex_apps__linear` + tool `_list_issues`).
  const trimmed = rest.startsWith("_") ? rest.slice(1) : rest;

  // Special tools (Mains: savefindings → "SaveFindings", …). These bypass the
  // generic MCP renderer because tool-call-item.tsx has dedicated displays.
  const special = vendor.specialTools?.[trimmed];
  if (special) {
    return {
      displayName: special,
      groupKey: special.toLowerCase(),
      groupLabel: special,
      category: vendor.category,
      icon: vendor.icon,
      isSpecialGroup: false,
      isBuiltin: true,
    };
  }

  const underscoreIdx = trimmed.indexOf("_");
  const rawVerb = underscoreIdx > 0 ? trimmed.slice(0, underscoreIdx) : trimmed;
  const rawEntity = underscoreIdx > 0 ? trimmed.slice(underscoreIdx + 1) : "";
  const verbInfo = getVerbInfo(vendor, rawVerb);

  if (verbInfo) {
    const entity = snakeToWords(rawEntity);
    const displayName = entity.length > 0
      ? `${vendor.label} ${verbInfo.label} ${entity}`
      : `${vendor.label} ${verbInfo.label}`;
    return {
      displayName,
      groupKey: `${vendor.id}:${rawVerb}`,
      groupLabel: `${vendor.label} ${verbInfo.label}`,
      category: vendor.category,
      icon: vendor.icon,
      vendorId: vendor.id,
      verb: rawVerb,
      entity: entity.length > 0 ? entity : undefined,
      isSpecialGroup: false,
      isBuiltin: false,
    };
  }

  // No recognized verb — treat the whole tool name as the entity.
  const entity = snakeToWords(trimmed);
  const displayName = entity.length > 0
    ? `${vendor.label} ${entity}`
    : vendor.label;
  return {
    displayName,
    groupKey: `${vendor.id}:_other`,
    groupLabel: vendor.label,
    category: vendor.category,
    icon: vendor.icon,
    vendorId: vendor.id,
    entity: entity.length > 0 ? entity : undefined,
    isSpecialGroup: false,
    isBuiltin: false,
  };
}

/**
 * Generic fallback for any `mcp__…` tool that didn't match a registered
 * vendor. Splits on the `__` server/tool separator (servers themselves can
 * contain single underscores, e.g. `codex_apps`), then tries to detect a
 * sub-provider in the tool name (bridges like `codex_apps` route multiple
 * upstream MCPs through a single server, prefixing each tool with the inner
 * provider name — `gmail_search_emails`, `slack_send_message`, …).
 */
function resolveUnknownMcp(lower: string): ResolvedTool {
  const afterMcp = lower.slice("mcp__".length);
  const sepIdx = afterMcp.indexOf("__");
  const server = sepIdx > 0 ? afterMcp.slice(0, sepIdx) : afterMcp;
  const toolName = sepIdx > 0 ? afterMcp.slice(sepIdx + 2) : "";

  // Detect the sub-provider for bridge servers (`codex_apps` routes many
  // upstream MCPs through one server, prefixing each tool with the inner app).
  // Newer codex builds delimit the app with a DOT — `gmail.get_profile`,
  // `google_calendar.list_events` (the app slug may itself contain
  // underscores); older builds used a plain underscore — `gmail_search_emails`.
  // Prefer the dot boundary when present (unambiguous), else fall back to the
  // first-underscore heuristic (treat the leading token as the app unless it's
  // a known verb). The resolved `providerSlug` is what the plugin-logo lookup
  // keys on, so getting the app boundary right is what restores its icon.
  let providerLabel = titleCase(snakeToWords(server));
  let providerSlug = server;
  let verbAndEntity = toolName;

  const dotIdx = toolName.indexOf(".");
  if (dotIdx > 0) {
    providerSlug = toolName.slice(0, dotIdx);
    providerLabel = titleCase(snakeToWords(providerSlug));
    verbAndEntity = toolName.slice(dotIdx + 1);
  } else {
    const firstUnderscore = toolName.indexOf("_");
    if (firstUnderscore > 0) {
      const candidate = toolName.slice(0, firstUnderscore);
      const rest = toolName.slice(firstUnderscore + 1);
      if (!DEFAULT_VERBS[candidate]) {
        providerLabel = titleCase(candidate);
        providerSlug = candidate;
        verbAndEntity = rest;
      }
    }
    // If toolName has no separator (e.g. `authenticate`), keep the server as
    // the provider label and treat the whole tool name as the entity.
  }

  const ueIdx = verbAndEntity.indexOf("_");
  const rawVerb = ueIdx > 0 ? verbAndEntity.slice(0, ueIdx) : verbAndEntity;
  const rawEntity = ueIdx > 0 ? verbAndEntity.slice(ueIdx + 1) : "";
  const verbInfo = DEFAULT_VERBS[rawVerb];
  const icon = <Mcp className="size-4" />;

  if (verbInfo) {
    const entity = snakeToWords(rawEntity);
    const displayName = entity.length > 0
      ? `${providerLabel} ${verbInfo.label} ${entity}`
      : `${providerLabel} ${verbInfo.label}`;
    return {
      displayName,
      groupKey: `${providerSlug}:${rawVerb}`,
      groupLabel: `${providerLabel} ${verbInfo.label}`,
      category: "MCP",
      icon,
      vendorId: providerSlug,
      verb: rawVerb,
      entity: entity.length > 0 ? entity : undefined,
      isSpecialGroup: false,
      isBuiltin: false,
    };
  }

  const entity = snakeToWords(verbAndEntity);
  const displayName = entity.length > 0
    ? `${providerLabel} ${entity}`
    : providerLabel;
  return {
    displayName,
    groupKey: `${providerSlug}:_other`,
    groupLabel: providerLabel,
    category: "MCP",
    icon,
    vendorId: providerSlug,
    entity: entity.length > 0 ? entity : undefined,
    isSpecialGroup: false,
    isBuiltin: false,
  };
}

/**
 * Label for a tool with no registry entry. PascalCase/camelCase names are
 * already readable and are kept verbatim (`SendMessage`, not `Send message`);
 * snake_case and kebab-case get split into words so a raw `send_message` isn't
 * shown as the mangled `Send_message`.
 */
function humanizeToolName(toolName: string): string {
  const trimmed = toolName.trim();
  if (trimmed.length === 0) return "Tool";
  if (/[_-]/.test(trimmed)) {
    return titleCase(trimmed.replace(/[_-]+/g, " ").trim());
  }
  return titleCase(trimmed);
}

function resolveToolImpl(toolName: string): ResolvedTool {
  const lower = toolName.toLowerCase();

  // Vendor prefix wins — `mcp__linear__list_issues` resolves cleanly even
  // though the builtin `search` substring is contained in it.
  const vendorHit = findVendor(lower);
  if (vendorHit) {
    return resolveVendorTool(vendorHit.vendor, vendorHit.rest);
  }

  // Any other `mcp__…` tool: generic MCP fallback. We never run findBuiltin
  // on MCP-prefixed names because the loose contains-fallback would match
  // arbitrary substrings (e.g. `gmail_search_emails` matching builtin
  // Search; `read_email_thread` matching builtin Read).
  if (lower.startsWith("mcp__")) {
    return resolveUnknownMcp(lower);
  }

  const builtin = findBuiltin(lower);
  if (builtin) {
    return {
      displayName: builtin.displayName,
      groupKey: builtin.groupKey,
      groupLabel: builtin.displayName,
      category: builtin.category,
      icon: builtin.icon,
      isSpecialGroup: builtin.isSpecialGroup ?? false,
      isBuiltin: true,
    };
  }

  const label = humanizeToolName(toolName);
  return {
    displayName: label,
    groupKey: lower || "unknown",
    groupLabel: label,
    category: "Tool",
    icon: <Mcp className="size-4" />,
    isSpecialGroup: false,
    isBuiltin: false,
  };
}

/**
 * FIFO cache keyed by lowercased tool name. `resolveTool` is pure on the
 * extracted tool name (the JSON args after `:` are discarded), so identical
 * tool names always yield identical results — safe to share across callers.
 *
 * Memory ceiling: 500 entries × ~200 B ≈ 100 KB. In a long session the unique
 * tool-name set typically plateaus well below this, so eviction rarely fires.
 */
const RESOLVE_CACHE = new Map<string, ResolvedTool>();
const RESOLVE_CACHE_LIMIT = 500;

/**
 * Resolve a tool name (or full RunEvent content) into a `ResolvedTool`. Order
 * of resolution:
 *   1) Vendor prefix match → MCP tool (verb/entity parsed)
 *   2) Generic `mcp__…` fallback for any unrecognized vendor — never touches
 *      the builtin list, because substrings like `read`/`search`/`bash`
 *      legitimately appear inside MCP tool names (`gmail_read_email_thread`)
 *      and must not falsely match builtins.
 *   3) Built-in match (Read, Bash, …) — only for non-MCP names
 *   4) Plain unknown tool — keep the original name and use the Mcp icon
 */
export function resolveTool(rawNameOrContent: string): ResolvedTool {
  const toolName = extractToolName(rawNameOrContent);
  const key = toolName.toLowerCase();

  const cached = RESOLVE_CACHE.get(key);
  if (cached !== undefined) return cached;

  const resolved = resolveToolImpl(toolName);

  if (RESOLVE_CACHE.size >= RESOLVE_CACHE_LIMIT) {
    const firstKey = RESOLVE_CACHE.keys().next().value;
    if (firstKey !== undefined) RESOLVE_CACHE.delete(firstKey);
  }
  RESOLVE_CACHE.set(key, resolved);
  return resolved;
}
