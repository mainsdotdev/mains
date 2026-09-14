// ─────────────────────────────────────────────────────────────
// Provider-variant descriptor
//
// One table answering "what does provider-variant X look like and support?"
// so components and hooks read fields instead of re-deriving the answer with
// scattered `variant === "..."` ternaries. See CONTEXT.md "Provider variants".
//
// Renderer-only: the main-process drivers read the same config keys but never
// branch on variant (each driver only handles its own provider), so the table
// lives where the branching pain is. The config-key fields below are the
// renderer's half of a contract shared with the drivers — keep them in sync
// with what each driver reads (claude/copilot: permissionMode; codex:
// sandboxMode, modelReasoningEffort, serviceTier; cursor: mode).
// ─────────────────────────────────────────────────────────────

import type { ComponentType } from "react";
import { CopilotStatic, Codex, Cursor } from "@/components/ui/icons";
import { Claude } from "@/components/ui/icons/space";
import { DEFAULT_CLAUDE_PERMISSION_MODE } from "../../shared/claude-permission-modes";
import { PROVIDER_IDS, type ProviderId } from "../../shared/provider-ids";

export type ProviderVariant = "claude" | "copilot" | "codex" | "cursor";

/** Variant of the surface the user is on: a provider variant on `/code`, "default" elsewhere. */
export type WorkspaceVariant = ProviderVariant | "default";

/**
 * How a variant stores its "fast mode" toggle. Codex maps it to the "fast"
 * service tier (and accepts the legacy "priority" id); the others use a plain
 * boolean.
 */
export type FastModeStyle =
  | { kind: "boolean"; key: "fastMode" }
  | { kind: "serviceTier"; key: "serviceTier"; on: string; match: string[] };

/**
 * Config write performed when the user leaves plan mode: set `key` (currently
 * holding `planValue`) to `nextValue`. Note codex uses a dedicated `planMode`
 * boolean here, distinct from its `permissionKey` (`sandboxMode`).
 */
export interface PlanExitConfig {
  key: string;
  planValue: string | boolean;
  nextValue: string | boolean;
}

export interface ProviderVariantDescriptor {
  variant: ProviderVariant;
  providerId: ProviderId;
  /** Human-facing name ("Claude", "Copilot", …) — the one source for tab/page/picker labels. */
  label: string;
  /** Tab/header icon for this variant. */
  icon: ComponentType<{ className?: string }>;
  /** Accent class always applied to this variant's icon (e.g. Claude's tint). */
  accentClassName?: string;

  // ── config-key contract (renderer reads/writes; mirrors the drivers' reads) ──
  /** Config key holding the permission/sandbox mode. */
  permissionKey: string;
  /** Default permission mode when the config key is unset. */
  permissionDefault: string;
  /** Config key holding the effort level. */
  effortKey: "modelReasoningEffort" | "effortLevel";
  /**
   * Preferred effort level when the selected model supports effort but the
   * config holds none. `pickDefaultEffort` clamps this to what the model
   * actually offers, so a variant never has to enumerate per-model levels.
   */
  effortDefault: string;
  /**
   * When true, "thinking on" is inferred from the presence of an effort value
   * (no separate `thinkingMode` boolean), and an effort change writes only
   * `effortKey`. When false, thinking is its own `thinkingMode` boolean.
   */
  thinkingCoupledToEffort: boolean;
  fastMode: FastModeStyle;

  /**
   * Shell command that (re)authenticates this variant's CLI, offered when a
   * run fails with an auth error or the account probe reports signed-out.
   * Runs in the in-app terminal — the login flows are interactive.
   */
  authLoginCommand: string;

  // ── capability flags (drive UI gates and behavior) ──
  supportsUltracode: boolean;
  supportsPlanMode: boolean;
  supportsGoalMode: boolean;
  supportsSkills: boolean;
  /** Whether the provider's driver implements the plugin API (gates the Plugins page). */
  supportsPlugins: boolean;

  // ── /code page wiring (was per-route props before the agent routes unified) ──
  planExit: PlanExitConfig;
  enableForkRun: boolean;
  enableSuggestions: boolean;
}

export const PROVIDER_VARIANTS: Record<ProviderVariant, ProviderVariantDescriptor> = {
  claude: {
    variant: "claude",
    label: "Claude",
    providerId: PROVIDER_IDS.claude,
    icon: Claude,
    accentClassName: "text-claude",
    permissionKey: "permissionMode",
    permissionDefault: DEFAULT_CLAUDE_PERMISSION_MODE,
    effortKey: "effortLevel",
    effortDefault: "medium",
    thinkingCoupledToEffort: false,
    fastMode: { kind: "boolean", key: "fastMode" },
    authLoginCommand: "claude auth login",
    supportsUltracode: true,
    supportsPlanMode: false,
    supportsGoalMode: false,
    supportsSkills: true,
    supportsPlugins: true,
    planExit: { key: "permissionMode", planValue: "plan", nextValue: "acceptEdits" },
    enableForkRun: true,
    enableSuggestions: true,
  },
  copilot: {
    variant: "copilot",
    label: "Copilot",
    providerId: PROVIDER_IDS.copilot,
    icon: CopilotStatic,
    permissionKey: "permissionMode",
    permissionDefault: "default",
    effortKey: "modelReasoningEffort",
    effortDefault: "medium",
    thinkingCoupledToEffort: true,
    fastMode: { kind: "boolean", key: "fastMode" },
    authLoginCommand: "gh auth login",
    supportsUltracode: false,
    supportsPlanMode: false,
    supportsGoalMode: false,
    supportsSkills: false,
    supportsPlugins: false,
    planExit: { key: "permissionMode", planValue: "plan", nextValue: "acceptEdits" },
    enableForkRun: false,
    enableSuggestions: false,
  },
  codex: {
    variant: "codex",
    label: "Codex",
    providerId: PROVIDER_IDS.codex,
    icon: Codex,
    permissionKey: "sandboxMode",
    permissionDefault: "workspace-write",
    effortKey: "modelReasoningEffort",
    effortDefault: "medium",
    thinkingCoupledToEffort: true,
    fastMode: { kind: "serviceTier", key: "serviceTier", on: "fast", match: ["fast", "priority"] },
    authLoginCommand: "codex login",
    supportsUltracode: false,
    supportsPlanMode: true,
    supportsGoalMode: true,
    supportsSkills: true,
    supportsPlugins: true,
    planExit: { key: "planMode", planValue: true, nextValue: false },
    enableForkRun: true,
    enableSuggestions: false,
  },
  cursor: {
    variant: "cursor",
    label: "Cursor",
    providerId: PROVIDER_IDS.cursor,
    icon: Cursor,
    permissionKey: "mode",
    permissionDefault: "agent",
    effortKey: "effortLevel",
    effortDefault: "medium",
    thinkingCoupledToEffort: false,
    fastMode: { kind: "boolean", key: "fastMode" },
    authLoginCommand: "agent login",
    supportsUltracode: false,
    supportsPlanMode: false,
    supportsGoalMode: false,
    supportsSkills: false,
    supportsPlugins: false,
    planExit: { key: "mode", planValue: "plan", nextValue: "agent" },
    enableForkRun: true,
    enableSuggestions: true,
  },
};

export function getProviderVariant(variant: ProviderVariant): ProviderVariantDescriptor {
  return PROVIDER_VARIANTS[variant];
}

/**
 * Canonical low→high ordering of effort levels, used to clamp a preferred level
 * onto whatever the selected model actually advertises.
 */
const EFFORT_RANK = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Resolve the effort level to select when a model supports effort but none is
 * stored. Prefers `preferred`; otherwise the supported level closest to it in
 * `EFFORT_RANK`, so a model missing "medium" lands on "low"/"high" rather than
 * jumping to the most expensive tier. Returns "" when the model has no levels.
 */
export function pickDefaultEffort(
  supported: readonly string[] | undefined,
  preferred: string,
): string {
  if (!supported || supported.length === 0) return "";
  if (supported.includes(preferred)) return preferred;

  const target = EFFORT_RANK.indexOf(preferred);
  if (target < 0) return supported[supported.length - 1];

  let best: string | undefined;
  let bestDistance = Infinity;
  for (const level of supported) {
    const rank = EFFORT_RANK.indexOf(level);
    if (rank < 0) continue;
    // Ties (equidistant above/below) resolve downward: `<` keeps the first
    // match, and the loop walks `supported` in the driver's low→high order.
    const distance = Math.abs(rank - target);
    if (distance < bestDistance) {
      best = level;
      bestDistance = distance;
    }
  }
  return best ?? supported[supported.length - 1];
}

/**
 * Reverse lookup for callers that hold a provider id (pulse pickers, stats
 * filters) rather than a variant. Undefined for non-agent provider ids.
 */
export function getProviderVariantById(
  providerId: string,
): ProviderVariantDescriptor | undefined {
  return Object.values(PROVIDER_VARIANTS).find(
    (d) => d.providerId === providerId,
  );
}
