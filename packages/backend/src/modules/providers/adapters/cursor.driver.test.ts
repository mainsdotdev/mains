// ─────────────────────────────────────────────────────────────
// Pure-function tests for cursor.driver.
//
// The cursor SDK (ACP subprocess) is not exercised here — those are
// integration concerns. These tests cover the deterministic helpers that
// translate cursor-specific stop reasons into the canonical DriverOutcome.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from "vitest";
import {
  applyCursorSessionMode,
  mapStopReasonToOutcome,
  normalizeCursorReasoning,
  extractCursorEffortLevels,
  resolveCursorEffortValue,
  resolveCursorBooleanValue,
  findCursorEffortOption,
  findCursorFastOption,
  extractCursorModelCaps,
  buildCursorModelInfo,
  resolveCursorSelection,
  splitCursorModelSpec,
  parseCursorAbout,
  parseCursorCommands,
  type CursorConfigOption,
} from "./cursor.driver";
import { resolveCatalogDefaultId } from "./adapter.shared";

describe("cursor.driver / session mode", () => {
  it("explicitly resets a resumed plan session back to agent mode", async () => {
    const sendRequest = vi.fn().mockResolvedValue({});

    await applyCursorSessionMode(
      { sendRequest },
      "session-1",
      "agent",
    );

    expect(sendRequest).toHaveBeenCalledWith("session/set_mode", {
      sessionId: "session-1",
      modeId: "agent",
    });
  });
});

// A realistic parameterized-model-picker config-option set, shaped like the
// `session/new` response when `_meta.parameterizedModelPicker` is advertised.
// (See apps/server/scripts/cursor-acp-model-mismatch-probe.ts in t3code.)
const CONFIG_OPTIONS: CursorConfigOption[] = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "gpt-5.4",
    options: [
      { value: "gpt-5.4", name: "GPT-5.4" },
      { value: "composer-2.5", name: "Composer 2.5" },
      { value: "gpt-5.4", name: "GPT-5.4 (dup)" }, // duplicate value → deduped
    ],
  },
  {
    id: "effort",
    name: "Reasoning",
    category: "model_option",
    type: "select",
    currentValue: "medium",
    options: [
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
      { value: "xhigh", name: "Extra High" },
    ],
  },
  {
    id: "fast",
    name: "Fast Mode",
    category: "model_config",
    type: "select",
    currentValue: "false",
    options: [
      { value: "true", name: "On" },
      { value: "false", name: "Off" },
    ],
  },
];

describe("cursor.driver / mapStopReasonToOutcome", () => {
  it('maps "cancelled" to canceled status', () => {
    expect(mapStopReasonToOutcome("cancelled")).toEqual({ status: "canceled" });
  });

  it('maps "refusal" to failed with descriptive summary', () => {
    expect(mapStopReasonToOutcome("refusal")).toEqual({
      status: "failed",
      summary: "Agent refused the request",
    });
  });

  it('maps "max_tokens" to succeeded with truncation summary', () => {
    expect(mapStopReasonToOutcome("max_tokens")).toEqual({
      status: "succeeded",
      summary: "Response truncated (max tokens)",
    });
  });

  it("maps unknown / undefined stop reasons to succeeded", () => {
    expect(mapStopReasonToOutcome(undefined)).toEqual({ status: "succeeded" });
    expect(mapStopReasonToOutcome("end_turn")).toEqual({ status: "succeeded" });
    expect(mapStopReasonToOutcome("anything-else")).toEqual({ status: "succeeded" });
  });
});

describe("cursor.driver / normalizeCursorReasoning", () => {
  it("passes through canonical levels", () => {
    for (const lvl of ["low", "medium", "high", "max"] as const) {
      expect(normalizeCursorReasoning(lvl)).toBe(lvl);
    }
  });

  it("folds xhigh aliases and is case/space-insensitive", () => {
    expect(normalizeCursorReasoning("xhigh")).toBe("xhigh");
    expect(normalizeCursorReasoning("Extra-High")).toBe("xhigh");
    expect(normalizeCursorReasoning("  EXTRA HIGH ")).toBe("xhigh");
    expect(normalizeCursorReasoning("HIGH")).toBe("high");
  });

  it("returns undefined for unknown / non-string input", () => {
    expect(normalizeCursorReasoning("ultra")).toBeUndefined();
    expect(normalizeCursorReasoning("")).toBeUndefined();
    expect(normalizeCursorReasoning(undefined)).toBeUndefined();
    expect(normalizeCursorReasoning(7)).toBeUndefined();
  });
});

describe("cursor.driver / config-option discovery", () => {
  it("extracts distinct effort levels in advertised order", () => {
    expect(extractCursorEffortLevels(CONFIG_OPTIONS)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("returns [] when no effort option is present", () => {
    expect(extractCursorEffortLevels([CONFIG_OPTIONS[0]])).toEqual([]);
    expect(extractCursorEffortLevels([])).toEqual([]);
    expect(extractCursorEffortLevels(undefined)).toEqual([]);
  });

  it("prefers the model_option-category effort select", () => {
    const opt = findCursorEffortOption(CONFIG_OPTIONS);
    expect(opt?.id).toBe("effort");
  });

  it("finds the fast-mode option", () => {
    expect(findCursorFastOption(CONFIG_OPTIONS)?.id).toBe("fast");
  });

  it("resolves an advertised effort value, rejecting unsupported ones", () => {
    const opt = findCursorEffortOption(CONFIG_OPTIONS)!;
    expect(resolveCursorEffortValue(opt, "high")).toBe("high");
    expect(resolveCursorEffortValue(opt, "xhigh")).toBe("xhigh");
    expect(resolveCursorEffortValue(opt, "max")).toBeUndefined();
  });

  it("resolves boolean toggles against a true/false select", () => {
    const opt = findCursorFastOption(CONFIG_OPTIONS)!;
    expect(resolveCursorBooleanValue(opt, true)).toBe("true");
    expect(resolveCursorBooleanValue(opt, false)).toBe("false");
  });

  it("passes booleans through for native boolean options", () => {
    const boolOpt: CursorConfigOption = {
      id: "thinking",
      category: "model_config",
      type: "boolean",
    };
    expect(resolveCursorBooleanValue(boolOpt, true)).toBe(true);
    expect(resolveCursorBooleanValue(boolOpt, false)).toBe(false);
  });
});

describe("cursor.driver / catalog default", () => {
  // Ids as `cursor-agent acp` actually advertises them (session/new →
  // configOptions[category=model]), in advertised order. The auto-routing model
  // is `default` / "Auto" — there is no `auto` id; that spelling only exists as
  // the CLI's `--model` flag value.
  const CATALOG = [
    "default",
    "grok-4.5",
    "composer-2.5",
    "claude-opus-5",
    "gpt-5.4-nano",
    "glm-5.2",
  ];

  it("defaults to Cursor's Auto entry, not the CLI's last-used model", () => {
    // `currentModelId` is intentionally absent from the preference list: the
    // caps probe rewrites it per model, so it settles on the last id probed.
    expect(resolveCatalogDefaultId(CATALOG, undefined, ["default", "auto"])).toBe(
      "default",
    );
  });

  it("still honors a model the user pinned", () => {
    expect(resolveCatalogDefaultId(CATALOG, "composer-2.5", ["default", "auto"])).toBe(
      "composer-2.5",
    );
  });

  it("falls back to Auto when the pinned model left the account's catalog", () => {
    expect(resolveCatalogDefaultId(CATALOG, "composer-1.0", ["default", "auto"])).toBe(
      "default",
    );
  });

  it("falls back to the first advertised model if Auto itself is ever dropped", () => {
    // Cursor could retire or rename the auto-routing entry. The catalog's own
    // ordering is the last resort — never `currentModelId`, and never a second
    // hardcoded id (that is the rot this table exists to avoid).
    const withoutAuto = CATALOG.filter((id) => id !== "default");
    expect(resolveCatalogDefaultId(withoutAuto, undefined, ["default", "auto"])).toBe(
      "grok-4.5",
    );
  });

  it("keeps honoring a pinned model even with Auto gone", () => {
    const withoutAuto = CATALOG.filter((id) => id !== "default");
    expect(
      resolveCatalogDefaultId(withoutAuto, "claude-opus-5", ["default", "auto"]),
    ).toBe("claude-opus-5");
  });
});

describe("cursor.driver / extractCursorModelCaps", () => {
  it("mines effort levels + fast flag for a reasoning model", () => {
    expect(extractCursorModelCaps(CONFIG_OPTIONS)).toEqual({
      effortLevels: ["low", "medium", "high", "xhigh"],
      hasFast: true,
    });
  });

  it("reports fast-only for a model without effort (e.g. composer)", () => {
    const composerOpts: CursorConfigOption[] = [
      { id: "model", category: "model", type: "select", options: [] },
      {
        id: "fast",
        name: "Fast",
        category: "model_config",
        type: "select",
        currentValue: "true",
        options: [{ value: "false" }, { value: "true" }],
      },
    ];
    expect(extractCursorModelCaps(composerOpts)).toEqual({
      effortLevels: [],
      hasFast: true,
    });
  });

  it("returns empty caps for nullish / capless options", () => {
    expect(extractCursorModelCaps(undefined)).toEqual({ effortLevels: [], hasFast: false });
    expect(extractCursorModelCaps([])).toEqual({ effortLevels: [], hasFast: false });
  });
});

describe("cursor.driver / buildCursorModelInfo", () => {
  it("attaches effort + fast metadata from caps", () => {
    const caps = extractCursorModelCaps(CONFIG_OPTIONS);
    expect(buildCursorModelInfo("gpt-5.4", "GPT-5.4", true, caps)).toEqual({
      id: "gpt-5.4",
      displayName: "GPT-5.4",
      isDefault: true,
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh"],
      supportsFastMode: true,
    });
  });

  it("omits effort/fast fields when caps are missing or empty", () => {
    expect(buildCursorModelInfo("composer-2.5", "Composer 2.5", false, undefined)).toEqual({
      id: "composer-2.5",
      displayName: "Composer 2.5",
      isDefault: false,
    });
    expect(
      buildCursorModelInfo("x", "X", false, { effortLevels: [], hasFast: false }),
    ).toEqual({ id: "x", displayName: "X", isDefault: false });
  });

  it("falls back to id when displayName is empty", () => {
    expect(buildCursorModelInfo("gpt-5.4", "", false, undefined).displayName).toBe("gpt-5.4");
  });
});

describe("cursor.driver / splitCursorModelSpec", () => {
  it("returns a bare id unchanged", () => {
    expect(splitCursorModelSpec("gpt-5.4")).toEqual({ baseId: "gpt-5.4" });
  });

  it("strips a [fast=true] suffix and surfaces the flag", () => {
    expect(splitCursorModelSpec("composer-2.5[fast=true]")).toEqual({
      baseId: "composer-2.5",
      fast: true,
    });
    expect(splitCursorModelSpec("composer-2.5[fast=false]")).toEqual({
      baseId: "composer-2.5",
      fast: false,
    });
  });

  it("strips other suffixes without inventing a fast flag", () => {
    expect(splitCursorModelSpec("gpt-5.4[reasoning=high]")).toEqual({
      baseId: "gpt-5.4",
    });
  });

  it("handles empty / nullish input", () => {
    expect(splitCursorModelSpec(undefined)).toEqual({ baseId: undefined });
    expect(splitCursorModelSpec("")).toEqual({ baseId: undefined });
    expect(splitCursorModelSpec("  ")).toEqual({ baseId: undefined });
  });
});

describe("cursor.driver / parseCursorCommands", () => {
  it("maps available_commands_update entries to CommandInfo, deduped", () => {
    const raw = [
      { name: "simplify", description: "Find low-info comments" },
      { name: "multi-model-review", description: "Pick models, parallel reviewers" },
      { name: "simplify", description: "dup — dropped" },
      { name: "  copy-request-id  ", description: "  Copy the last request ID  " },
    ];
    expect(parseCursorCommands(raw)).toEqual([
      { name: "simplify", description: "Find low-info comments", userFacing: true },
      {
        name: "multi-model-review",
        description: "Pick models, parallel reviewers",
        userFacing: true,
      },
      { name: "copy-request-id", description: "Copy the last request ID", userFacing: true },
    ]);
  });

  it("handles missing descriptions and skips invalid entries", () => {
    const raw = [
      { name: "bare" },
      { name: "" },
      null,
      "nope",
      { description: "no name" },
    ];
    expect(parseCursorCommands(raw)).toEqual([
      { name: "bare", description: undefined, userFacing: true },
    ]);
  });

  it("returns [] for non-array input", () => {
    expect(parseCursorCommands(undefined)).toEqual([]);
    expect(parseCursorCommands(null)).toEqual([]);
    expect(parseCursorCommands({})).toEqual([]);
  });
});

describe("cursor.driver / parseCursorAbout", () => {
  const JSON_AUTHED = JSON.stringify({
    cliVersion: "2026.05.09-0afadcc",
    model: "Composer 2.5 Fast",
    subscriptionTier: "Pro",
    userEmail: "user@example.com",
  });

  it("parses the authenticated JSON form", () => {
    expect(parseCursorAbout(JSON_AUTHED)).toEqual({
      version: "2026.05.09-0afadcc",
      email: "user@example.com",
      subscriptionTier: "Pro",
      authenticated: true,
      commandUnsupported: false,
    });
  });

  it("treats null/missing userEmail as not authenticated", () => {
    const out = parseCursorAbout(
      JSON.stringify({ cliVersion: "1.0", subscriptionTier: "Free", userEmail: null }),
    );
    expect(out.authenticated).toBe(false);
    expect(out.email).toBeNull();
    expect(out.version).toBe("1.0");
    expect(out.subscriptionTier).toBe("Free");
  });

  it('treats "not logged in" sentinel as unauthenticated', () => {
    expect(parseCursorAbout(JSON.stringify({ userEmail: "Not logged in" })).authenticated).toBe(
      false,
    );
  });

  it("parses the plain-text key/value form", () => {
    const plain = [
      "About Cursor CLI",
      "",
      "CLI Version         2026.05.09-0afadcc",
      "Subscription Tier   Pro",
      "User Email          user@example.com",
    ].join("\n");
    expect(parseCursorAbout(plain)).toEqual({
      version: "2026.05.09-0afadcc",
      email: "user@example.com",
      subscriptionTier: "Pro",
      authenticated: true,
      commandUnsupported: false,
    });
  });

  it("strips ANSI escapes from plain-text output", () => {
    const ansi = "User Email          \x1b[32muser@example.com\x1b[0m";
    expect(parseCursorAbout(ansi).email).toBe("user@example.com");
  });

  it("flags an old CLI that doesn't support the command/flag", () => {
    expect(
      parseCursorAbout("", "error: unexpected argument '--format' found").commandUnsupported,
    ).toBe(true);
    expect(parseCursorAbout("unknown command: about").commandUnsupported).toBe(true);
  });

  it("returns unauthenticated for empty output", () => {
    expect(parseCursorAbout("")).toEqual({
      version: null,
      email: null,
      subscriptionTier: null,
      authenticated: false,
      commandUnsupported: false,
    });
  });
});

describe("cursor.driver / resolveCursorSelection", () => {
  it("prefers per-run snapshot overrides over provider config", () => {
    expect(
      resolveCursorSelection(
        { effortLevel: "high", fastMode: true },
        { effortLevel: "low", fastMode: false, thinking: true },
      ),
    ).toEqual({ effort: "high", fastMode: true, thinking: true });
  });

  it("falls back to provider config when no overrides", () => {
    expect(
      resolveCursorSelection({}, { effortLevel: "medium", fastMode: true }),
    ).toEqual({ effort: "medium", fastMode: true, thinking: undefined });
  });

  it("accepts thinkingMode as an alias for thinking", () => {
    expect(resolveCursorSelection({ thinkingMode: true }, {})).toMatchObject({
      thinking: true,
    });
  });

  it("returns all-undefined when nothing is set", () => {
    expect(resolveCursorSelection({}, {})).toEqual({
      effort: undefined,
      fastMode: undefined,
      thinking: undefined,
    });
  });
});
