import type { ProviderVariant } from "./provider-variants";

function formatCursorModelName(model: string): string {
  if (model === "default") return "Default";
  if (model === "composer-2" ) return "Composer 2 (Fast)";
  if (model === "composer-2.5") return "Composer 2.5 (Fast)";

  const BRANDS: Record<string, string> = {
    gpt: "GPT",
    claude: "Claude",
    gemini: "Gemini",
    composer: "Composer",
    grok: "Grok",
    kimi: "Kimi",
    codex: "Codex",
  };

  const parts = model.split("-");
  const brand = parts[0];
  const brandDisplay = BRANDS[brand] ?? (brand.charAt(0).toUpperCase() + brand.slice(1));
  const rest = parts.slice(1);
  const tokens: string[] = [];

  let i = 0;
  while (i < rest.length) {
    const curr = rest[i];
    const next = rest[i + 1];
    if (/^\d+$/.test(curr) && next !== undefined && /^\d+$/.test(next)) {
      tokens.push(`${curr}.${next}`);
      i += 2;
    } else {
      tokens.push(/^[\d.]/.test(curr) ? curr : curr.charAt(0).toUpperCase() + curr.slice(1));
      i++;
    }
  }

  if (tokens.length === 0) return brandDisplay;
  if (brand === "gpt" && /^[\d.]/.test(tokens[0])) {
    return `${brandDisplay}-${tokens.join("-")}`;
  }
  return `${brandDisplay} ${tokens.join(" ")}`;
}

function removeGptNameSeparators(model: string): string {
  if (!/^gpt-/i.test(model)) return model;
  return model.replace(/^gpt-/i, "GPT ").replace(/-/g, " ");
}

export function formatModelDisplayName(model: string, variant?: ProviderVariant): string {
  const formatted =
    variant === "cursor" ? formatCursorModelName(model) : model;
  return removeGptNameSeparators(formatted);
}

export function getModelPrettyName(
  model: { displayName: string; description?: string },
  variant?: ProviderVariant,
): string {
  if (variant === "cursor") return formatCursorModelName(model.displayName);
  if (variant === "claude" && model.description) {
    const firstPart = model.description.split("·")[0].trim();
    // Older Claude catalogues put the version in the description, but newer
    // ones use it only for a tagline. A tagline can also be shared by several
    // models, so it must never replace the SDK's display name.
    const name = model.displayName.replace(/^Claude\s+/i, "").trim();
    const describedName = firstPart.replace(/^Claude\s+/i, "");
    const remainder = describedName.slice(name.length);
    if (
      (model.description.includes("·") || firstPart.endsWith(" with 1M context")) &&
      name &&
      describedName.toLowerCase().startsWith(name.toLowerCase()) &&
      (!remainder || /^[\s([]/.test(remainder))
    ) {
      return firstPart.replace(/ with 1M context$/, " [1M]");
    }
  }
  return model.displayName;
}

type ModelDisplayInfo = {
  id: string;
  displayName: string;
  description?: string;
};

const CLAUDE_MODEL_FAMILIES = ["fable", "sonnet", "opus", "haiku"] as const;

function claudeModelFamily(model: string): string | undefined {
  const tokens = model.toLowerCase().split(/[-_\s[\]]+/).filter(Boolean);
  return CLAUDE_MODEL_FAMILIES.find((family) => tokens.includes(family));
}

/**
 * Resolve a persisted/provider-reported model id through the same catalogue
 * labels used by ModelSelectDropdown.
 *
 * Claude reports canonical usage ids (`claude-haiku-4-5-20251001`) while its
 * picker exposes rolling aliases (`haiku`). When there is no exact id match,
 * match that canonical id back to its family alias so the transcript still
 * gets the dropdown's current user-facing name and description.
 */
export function resolveModelDisplayName(
  modelId: string,
  models: ModelDisplayInfo[],
  variant?: ProviderVariant,
): string {
  const normalizedId = modelId.trim().toLowerCase();
  const exact = models.find(
    (model) => model.id.trim().toLowerCase() === normalizedId,
  );
  if (exact) return getModelPrettyName(exact, variant);

  if (variant === "claude") {
    const family = claudeModelFamily(normalizedId);
    if (family) {
      const familyModels = models.filter(
        (model) => claudeModelFamily(model.id) === family,
      );
      const wantsExtendedContext = normalizedId.includes("[1m]");
      const familyMatch = wantsExtendedContext
        ? familyModels.find((model) => model.id.toLowerCase().includes("[1m]"))
        : familyModels.find((model) => model.id.toLowerCase() === family) ??
          familyModels.find((model) => !model.id.toLowerCase().includes("[1m]"));
      if (familyMatch) return getModelPrettyName(familyMatch, variant);
    }
  }

  return formatModelDisplayName(modelId, variant);
}

/**
 * Narrow a list of model display names down to the ones worth offering in the
 * picker.
 *
 * Only Cursor's `default` placeholder is hidden — it names no actual model, it
 * just means "whatever Cursor picks", which the real entries already cover.
 *
 * `auto` deliberately stays: on Copilot and Cursor it is a genuine choice (the
 * provider routes each turn to a model for you). It used to be filtered out
 * alongside `default`, which hid it on Cursor and — on Copilot plans where the
 * CLI offers nothing else — emptied the list entirely, so the picker read
 * "No models found" when a perfectly usable model was available.
 */
export function selectableModelNames(
  models: string[],
  variant?: ProviderVariant,
): string[] {
  return (Array.isArray(models) ? models : []).filter(
    (m) => !(variant === "cursor" && m.trim().toLowerCase() === "default"),
  );
}

/** Keep the first model when multiple entries share the same UI label. */
export function dedupeModelsByPrettyName<T extends { displayName: string; description?: string }>(
  models: T[],
  variant?: ProviderVariant,
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const model of models) {
    const pretty = getModelPrettyName(model, variant);
    if (seen.has(pretty)) continue;
    seen.add(pretty);
    result.push(model);
  }
  return result;
}
