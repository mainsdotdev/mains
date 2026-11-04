import { EFFORT_LEVELS } from "@mains/contracts/runs";
import type { ModelServiceTier } from "@mains/contracts/run-settings";

/**
 * Model and effort helpers — the phone's half of the desktop's
 * `lib/model-icons.tsx` / `lib/provider-variants.ts` / `lib/format.ts`, kept
 * to the same rules so a model reads the same on both screens.
 */

/** Codex and Copilot store the effort directly and infer "thinking" from it. */
export function isEffortCoupled(providerId: string): boolean {
  return providerId === "codex" || providerId === "copilot_cli";
}

/** Codex's CLI has no "reasoning off"; every other provider does. */
export function effortOffAllowed(providerId: string): boolean {
  return providerId !== "codex";
}

/**
 * The effort a provider's config holds, as the desktop's dropdown shows it:
 * "" when reasoning is off, "ultracode" folded in for Claude.
 */
export function effortFromConfig(
  providerId: string,
  config: Record<string, unknown> | null | undefined,
): { effortLevel: string; thinkingMode: boolean } {
  const c = config ?? {};
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  if (isEffortCoupled(providerId)) {
    const level = str(c.modelReasoningEffort);
    return { effortLevel: level, thinkingMode: level !== "" };
  }
  const ultracode = providerId === "claude_code" && c.ultracode === true;
  return {
    effortLevel: ultracode ? "ultracode" : str(c.effortLevel),
    thinkingMode: c.thinkingMode === true,
  };
}

/** A permission / sandbox mode as the desktop's dropdown lists it. */
export interface PermissionModeOption {
  value: string;
  label: string;
  /** The toolbar pill's short form. */
  shortLabel: string;
  description: string;
}

/**
 * Permission modes per provider — a mirror of the desktop's
 * `lib/provider-modes.ts` plus the shared four Copilot reads (its driver has
 * no branch for Claude's `auto` / `dontAsk`).
 */
const CLAUDE_PERMISSION_MODES: PermissionModeOption[] = [
  { value: "default", label: "Ask permissions", shortLabel: "Ask", description: "Ask before changes" },
  { value: "auto", label: "Auto", shortLabel: "Auto", description: "Claude decides when to ask" },
  { value: "acceptEdits", label: "Auto accept edits", shortLabel: "Edit", description: "Accept all edits" },
  { value: "plan", label: "Plan mode", shortLabel: "Plan", description: "Plan before changes" },
  { value: "bypassPermissions", label: "Bypass permissions", shortLabel: "Bypass", description: "Bypass all permissions" },
  { value: "dontAsk", label: "Don't ask", shortLabel: "Don't Ask", description: "Deny unapproved tools silently" },
];

const PERMISSION_MODES: Record<string, PermissionModeOption[]> = {
  claude_code: CLAUDE_PERMISSION_MODES,
  copilot_cli: CLAUDE_PERMISSION_MODES.filter((m) =>
    ["default", "acceptEdits", "plan", "bypassPermissions"].includes(m.value),
  ),
  codex: [
    { value: "read-only", label: "Read Only", shortLabel: "Read Only", description: "Agent cannot modify files" },
    { value: "workspace-write", label: "Workspace Write", shortLabel: "Write", description: "Write within workspace only" },
    { value: "danger-full-access", label: "Full Access", shortLabel: "Full Access", description: "No restrictions" },
  ],
  cursor: [
    { value: "ask", label: "Ask", shortLabel: "Ask", description: "Ask before changes" },
    { value: "agent", label: "Agent", shortLabel: "Agent", description: "Full autonomous agent mode" },
    { value: "plan", label: "Plan", shortLabel: "Plan", description: "Plan before executing" },
  ],
  opencode: [
    { value: "build", label: "Build", shortLabel: "Build", description: "OpenCode's default coding agent" },
    { value: "plan", label: "Plan", shortLabel: "Plan", description: "Plan before changing files" },
  ],
};

/** What a provider starts on when its config holds no mode (desktop `permissionDefault`). */
const PERMISSION_DEFAULTS: Record<string, string> = {
  claude_code: "auto",
  copilot_cli: "default",
  codex: "workspace-write",
  cursor: "agent",
  opencode: "build",
};

/** The config key a provider keeps its permission / sandbox mode under. */
const PERMISSION_KEYS: Record<string, string> = {
  claude_code: "permissionMode",
  copilot_cli: "permissionMode",
  codex: "sandboxMode",
  cursor: "mode",
  opencode: "agent",
};

export function permissionModesFor(providerId: string): PermissionModeOption[] {
  return PERMISSION_MODES[providerId] ?? [];
}

export function permissionShortLabel(providerId: string, value: string): string {
  return permissionModesFor(providerId).find((m) => m.value === value)?.shortLabel ?? value;
}

/** Goal mode and the plan *toggle* are Codex's; elsewhere plan is a permission mode. */
export function supportsGoalMode(providerId: string): boolean {
  return providerId === "codex";
}
export function supportsPlanToggle(providerId: string): boolean {
  return providerId === "codex";
}

export interface RunSettings {
  effortLevel: string;
  thinkingMode: boolean;
  permissionMode: string;
  fastMode: boolean;
  goalMode: boolean;
  planMode: boolean;
}

/** Everything the composer toolbar shows, read out of a provider's config the way the desktop does. */
export function runSettingsFromConfig(
  providerId: string,
  config: Record<string, unknown> | null | undefined,
): RunSettings {
  const c = config ?? {};
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const effort = effortFromConfig(providerId, config);
  const permissionKey = PERMISSION_KEYS[providerId];
  const permissionMode = (permissionKey && str(c[permissionKey])) || PERMISSION_DEFAULTS[providerId] || "";
  const fastMode =
    providerId === "codex" ? ["fast", "priority", "ultrafast"].includes(str(c.serviceTier)) : c.fastMode === true;
  return {
    ...effort,
    permissionMode,
    fastMode,
    goalMode: providerId === "codex" && c.goalMode === true,
    planMode: providerId === "codex" && c.planMode === true,
  };
}

/** Display label for an effort level ("xhigh" → "Extra High", "" → "Off"). */
export function formatEffortLevel(level: string): string {
  if (!level) return "Off";
  if (level === "ultracode") return "Ultracode";
  if (level === "xhigh") return "Extra High";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/**
 * The level to select when a model supports effort but the stored one does
 * not fit: `preferred` if offered, else the supported level closest to it in
 * the low → high ranking. "" when the model has no levels.
 */
export function pickDefaultEffort(supported: readonly string[] | undefined, preferred: string): string {
  if (!supported || supported.length === 0) return "";
  if (supported.includes(preferred)) return preferred;
  const rank = EFFORT_LEVELS as readonly string[];
  const target = rank.indexOf(preferred);
  if (target < 0) return supported[supported.length - 1];
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const level of supported) {
    const index = rank.indexOf(level);
    if (index < 0) continue;
    const distance = Math.abs(index - target);
    if (distance < bestDistance) {
      best = level;
      bestDistance = distance;
    }
  }
  return best ?? supported[supported.length - 1];
}

/** How many models the sheet shows before "Show more". */
export const MODEL_PICKER_PREVIEW = 5;

/**
 * The catalogue slice that fits above the effort control. The selected model
 * stays in that slice even when it sorts later, so collapsing the list never
 * hides the checkmark.
 */
export function previewModels<T extends { id: string }>(
  models: readonly T[],
  selectedId: string | undefined,
  expanded: boolean,
): { visible: readonly T[]; hiddenCount: number; canFold: boolean } {
  const canFold = models.length > MODEL_PICKER_PREVIEW;
  if (expanded || !canFold) return { visible: models, hiddenCount: 0, canFold };
  const hiddenCount = models.length - MODEL_PICKER_PREVIEW;
  const selectedIndex = selectedId === undefined ? -1 : models.findIndex((model) => model.id === selectedId);
  if (selectedIndex < MODEL_PICKER_PREVIEW) {
    return { visible: models.slice(0, MODEL_PICKER_PREVIEW), hiddenCount, canFold };
  }
  const selected = models[selectedIndex];
  const others = models.filter((model) => model.id !== selected.id).slice(0, MODEL_PICKER_PREVIEW - 1);
  return { visible: [selected, ...others], hiddenCount, canFold };
}

/** A stepped slider stops being finger-sized past this many stops. */
const EFFORT_SLIDER_STOP_LIMIT = 6;

/**
 * What the model sheet draws under the catalogue.
 * `thinking` is Claude with no advertised levels. `toggle` is a single level
 * plus Off. `slider` is a short ranked scale. `list` is that scale once it
 * no longer fits a thumb. `hidden` means there is nothing to choose.
 */
export type EffortControl =
  | { kind: "hidden" }
  | { kind: "thinking"; on: boolean }
  | { kind: "toggle"; on: boolean; level: string }
  | { kind: "slider"; stops: readonly string[] }
  | { kind: "list"; options: readonly string[] };

/** Known levels in rank order, then any catalogue-only ids (Codex's `ultra`). Ultracode is never a stop. */
export function orderEffortLevels(levels: readonly string[]): string[] {
  const rank = EFFORT_LEVELS as readonly string[];
  const known = rank.filter((level) => levels.includes(level));
  const extra: string[] = [];
  for (const level of levels) {
    if (!level || level === "ultracode" || known.includes(level) || extra.includes(level)) continue;
    extra.push(level);
  }
  return [...known, ...extra];
}

export function effortControlFor(
  providerId: string,
  supported: readonly string[],
  effortLevel: string,
  thinkingMode: boolean,
): EffortControl {
  const levels = orderEffortLevels(supported);
  if (levels.length === 0) {
    return providerId === "claude_code" ? { kind: "thinking", on: thinkingMode } : { kind: "hidden" };
  }
  if (levels.length === 1) {
    return effortOffAllowed(providerId)
      ? { kind: "toggle", on: effortLevel === levels[0] || effortLevel === "ultracode", level: levels[0] }
      : { kind: "hidden" };
  }
  const stops = [...(effortOffAllowed(providerId) ? [""] : []), ...levels];
  if (stops.length > EFFORT_SLIDER_STOP_LIMIT) return { kind: "list", options: stops };
  return { kind: "slider", stops };
}

/** Claude keeps Ultracode beside the scale, never as its top stop. */
export function modelOffersUltracode(providerId: string, supported: readonly string[]): boolean {
  return providerId === "claude_code" && supported.includes("xhigh");
}

/** Where the thumb rests. Ultracode parks on Extra High; an unknown stored level uses the nearest ranked stop. */
export function effortStopIndex(stops: readonly string[], effortLevel: string): number {
  if (stops.length === 0) return 0;
  if (effortLevel === "ultracode") {
    const extraHigh = stops.indexOf("xhigh");
    return extraHigh >= 0 ? extraHigh : stops.length - 1;
  }
  const exact = stops.indexOf(effortLevel);
  if (exact >= 0) return exact;
  const nearest = stops.indexOf(pickDefaultEffort(stops.filter((stop) => stop.length > 0), effortLevel));
  return nearest >= 0 ? nearest : 0;
}

/** The composer's short effort text. Thinking that is off stays blank, matching the desktop model button. */
export function effortChoiceLabel(control: EffortControl, effortLevel: string): string | null {
  switch (control.kind) {
    case "hidden":
      return null;
    case "thinking":
      return control.on ? "On" : null;
    case "toggle":
    case "slider":
    case "list":
      return formatEffortLevel(effortLevel);
    default: {
      const unreachable: never = control;
      return unreachable;
    }
  }
}

/**
 * The name the desktop prints for a model: Cursor's ids are spelled out, the
 * rest show their display name. Older Claude catalogues carry a fuller name in
 * the description ("Opus 5.5 · …"), used only when it extends the display name.
 */
export function modelPrettyName(
  model: { displayName: string; description?: string | null },
  providerId: string,
): string {
  let name = model.displayName;

  if (providerId === "cursor") name = formatCursorModelName(name);
  if (providerId === "claude_code" && model.description) {
    name = claudeDescribedName(model.displayName, model.description) ?? name;
  }

  // Match desktop: humanise GPT display labels without changing the model id
  // sent back to the provider ("GPT-5.6-Sol" -> "GPT 5.6 Sol").
  if (/^gpt-/i.test(name)) {
    return name.replace(/^gpt-/i, "GPT ").replace(/-/g, " ");
  }
  return name;
}

/**
 * Newer Claude catalogues use the description only for a tagline, which
 * several models can share, so it must never replace the SDK's display name.
 * Mirrors the desktop's `getModelPrettyName`.
 */
function claudeDescribedName(displayName: string, description: string): string | undefined {
  const first = description.split("·")[0].trim();
  const name = displayName.replace(/^Claude\s+/i, "").trim();
  const described = first.replace(/^Claude\s+/i, "");
  const remainder = described.slice(name.length);
  if (
    (description.includes("·") || first.endsWith(" with 1M context")) &&
    name &&
    described.toLowerCase().startsWith(name.toLowerCase()) &&
    (!remainder || /^[\s([]/.test(remainder))
  ) {
    return first.replace(/ with 1M context$/, " [1M]");
  }
  return undefined;
}

/** Keeps the first model when several share a label. */
export function dedupeModelsByPrettyName<T extends { id?: string; displayName: string; description?: string | null }>(
  list: T[],
  providerId: string,
  selectedModelId?: string,
): T[] {
  const seen = new Map<string, number>();
  const result: T[] = [];
  for (const model of list) {
    const pretty = modelPrettyName(model, providerId);
    const existing = seen.get(pretty);
    if (existing !== undefined) {
      if (model.id === selectedModelId) result[existing] = model;
      continue;
    }
    seen.set(pretty, result.length);
    result.push(model);
  }
  return result;
}

function formatCursorModelName(model: string): string {
  if (model === "default") return "Default";
  if (model === "composer-2") return "Composer 2 (Fast)";
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
  const brandDisplay = BRANDS[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
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

/** The `models.effort_levels` column back into a list. */
export function parseEffortLevels(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function parseServiceTiers(json: string | null | undefined): ModelServiceTier[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((tier): tier is ModelServiceTier =>
      !!tier && typeof tier === "object" && typeof tier.id === "string" && typeof tier.name === "string",
    ) : [];
  } catch { return []; }
}
