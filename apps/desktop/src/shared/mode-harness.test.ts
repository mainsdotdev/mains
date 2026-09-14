// ─────────────────────────────────────────────────────────────
// Table-invariant tests for the mode harness — the same role
// provider-variants.test.ts plays for the variant descriptor.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { MODE_IDS } from "./modes";
import { PROVIDER_IDS } from "./provider-ids";
import {
  MODE_HARNESSES,
  getModeHarness,
  composeExtraInstructions,
  composeConfigSnapshot,
  composeToolPolicy,
  modeProviderSetting,
} from "./mode-harness";

describe("MODE_HARNESSES table invariants", () => {
  it("has an entry for every mode id, keyed consistently", () => {
    for (const mode of MODE_IDS) {
      expect(MODE_HARNESSES[mode]).toBeDefined();
      expect(MODE_HARNESSES[mode].mode).toBe(mode);
    }
  });

  it("locks developer to current behavior: no delta, no policy, no config", () => {
    const dev = MODE_HARNESSES.developer;
    expect(dev.promptDelta).toBeNull();
    expect(dev.toolPolicy).toBeNull();
    expect(dev.configDefaults).toEqual({});
    expect(dev.configOverrides).toEqual({});
  });

  it("keeps chat's allowlist free of write tools, Bash, and mains tools", () => {
    const allowed = MODE_HARNESSES.chat.toolPolicy?.allowedTools ?? [];
    for (const tool of ["Bash", "Write", "Edit", "NotebookEdit", "Task"]) {
      expect(allowed).not.toContain(tool);
    }
    expect(allowed.some((t) => t.startsWith("mcp__mains__"))).toBe(false);
  });

  it("denies Bash in work mode while keeping the default allowlist", () => {
    const policy = MODE_HARNESSES.work.toolPolicy;
    expect(policy?.allowedTools).toBeNull();
    expect(policy?.disallowedTools).toContain("Bash");
  });

  it("enforces read-only chat per provider via configOverrides", () => {
    const overrides = MODE_HARNESSES.chat.configOverrides;
    expect(overrides[PROVIDER_IDS.codex]).toMatchObject({ sandboxMode: "read-only" });
    expect(overrides[PROVIDER_IDS.cursor]).toEqual({ mode: "ask" });
    expect(overrides[PROVIDER_IDS.claude]).toEqual({ permissionMode: "default" });
    expect(overrides[PROVIDER_IDS.copilot]).toEqual({ permissionMode: "default" });
  });

  it("pins codex plan mode off outside developer — as an override", () => {
    // `planMode` sits on the shared provider row and is toggled from the
    // developer-only permission dropdown. Work and chat have no control to
    // turn it back off, so a Code space that left it on must not plan their
    // runs: an override, because there is no legitimate caller choice here.
    expect(MODE_HARNESSES.work.configOverrides[PROVIDER_IDS.codex]).toMatchObject({
      planMode: false,
    });
    expect(MODE_HARNESSES.chat.configOverrides[PROVIDER_IDS.codex]).toMatchObject({
      planMode: false,
    });
    expect(
      MODE_HARNESSES.developer.configOverrides[PROVIDER_IDS.codex],
    ).toBeUndefined();
  });

  it("pins codex goal mode off for chat only", () => {
    // Work keeps its goal button, so the flag stays caller-owned there.
    expect(MODE_HARNESSES.chat.configOverrides[PROVIDER_IDS.codex]).toMatchObject({
      goalMode: false,
    });
    expect(
      MODE_HARNESSES.work.configOverrides[PROVIDER_IDS.codex]?.goalMode,
    ).toBeUndefined();
    expect(
      MODE_HARNESSES.work.configDefaults[PROVIDER_IDS.codex]?.goalMode,
    ).toBeUndefined();
  });

  it("pins codex's tone for the non-developer modes only", () => {
    // Personality is codex's native tone lever; work/chat carry it as a
    // default so an explicit per-run choice still wins, and developer stays
    // on the provider setting.
    expect(MODE_HARNESSES.work.configDefaults[PROVIDER_IDS.codex]).toMatchObject({
      personality: "friendly",
    });
    expect(MODE_HARNESSES.chat.configDefaults[PROVIDER_IDS.codex]).toEqual({
      personality: "friendly",
    });
    expect(
      MODE_HARNESSES.developer.configDefaults[PROVIDER_IDS.codex],
    ).toBeUndefined();
  });

  it("limits work's overrides to the plan pin — its settings stay caller-overridable", () => {
    // Overrides are for values no client may choose for the mode. Work's
    // permission/sandbox/tone stay defaults; only the developer-side plan
    // toggle is pinned (see the codex plan-mode test above).
    expect(Object.keys(MODE_HARNESSES.developer.configOverrides)).toHaveLength(0);
    expect(MODE_HARNESSES.work.configOverrides).toEqual({
      [PROVIDER_IDS.codex]: { planMode: false },
    });
    expect(Object.keys(MODE_HARNESSES.chat.configOverrides).length).toBeGreaterThan(0);
  });

  it("resolves unknown or absent modes to developer", () => {
    expect(getModeHarness(undefined)).toBe(MODE_HARNESSES.developer);
    expect(getModeHarness(null)).toBe(MODE_HARNESSES.developer);
    expect(getModeHarness("bogus" as never)).toBe(MODE_HARNESSES.developer);
  });
});

describe("composeExtraInstructions", () => {
  it("returns null for developer with no space prompt", () => {
    expect(composeExtraInstructions("developer")).toBeNull();
    expect(composeExtraInstructions("developer", "   ")).toBeNull();
  });

  it("layers the mode delta before the space prompt", () => {
    const composed = composeExtraInstructions("work", "Always answer in Turkish.");
    expect(composed).toContain("non-technical");
    expect(composed?.endsWith("Always answer in Turkish.")).toBe(true);
    expect(composed?.indexOf("non-technical")).toBeLessThan(
      composed!.indexOf("Always answer in Turkish."),
    );
  });

  it("passes the space prompt through alone for developer", () => {
    expect(composeExtraInstructions("developer", "Be terse.")).toBe("Be terse.");
  });
});

describe("composeConfigSnapshot", () => {
  it("returns null when the mode adds nothing and the payload is empty", () => {
    expect(composeConfigSnapshot("developer", PROVIDER_IDS.codex)).toBeNull();
    expect(composeConfigSnapshot("developer", PROVIDER_IDS.codex, {})).toBeNull();
  });

  it("passes the payload through untouched for developer", () => {
    expect(
      composeConfigSnapshot("developer", PROVIDER_IDS.claude, { permissionMode: "plan" }),
    ).toEqual({ permissionMode: "plan" });
  });

  it("lets the payload beat work's defaults", () => {
    expect(
      composeConfigSnapshot("work", PROVIDER_IDS.claude, { permissionMode: "plan" }),
    ).toEqual({ permissionMode: "plan" });
    expect(composeConfigSnapshot("work", PROVIDER_IDS.claude)).toEqual({
      permissionMode: "acceptEdits",
    });
  });

  it("lets chat's overrides beat the payload — no client can escalate", () => {
    expect(
      composeConfigSnapshot("chat", PROVIDER_IDS.codex, {
        sandboxMode: "danger-full-access",
      }),
    ).toEqual({
      sandboxMode: "read-only",
      personality: "friendly",
      planMode: false,
      goalMode: false,
    });
    expect(
      composeConfigSnapshot("chat", PROVIDER_IDS.claude, {
        permissionMode: "bypassPermissions",
      }),
    ).toEqual({ permissionMode: "default" });
  });

  it("keeps unrelated payload keys alongside mode values", () => {
    expect(
      composeConfigSnapshot("chat", PROVIDER_IDS.codex, { effortLevel: "high" }),
    ).toEqual({
      effortLevel: "high",
      sandboxMode: "read-only",
      personality: "friendly",
      planMode: false,
      goalMode: false,
    });
  });

  it("turns codex plan mode off for work and chat even when the payload asks for it", () => {
    // The regression: plan toggled on in a Code space, provider row keeps it,
    // the user switches to a Work space and every run comes back as a plan.
    expect(
      composeConfigSnapshot("work", PROVIDER_IDS.codex, { planMode: true }),
    ).toMatchObject({ planMode: false });
    expect(
      composeConfigSnapshot("chat", PROVIDER_IDS.codex, { planMode: true, goalMode: true }),
    ).toMatchObject({ planMode: false, goalMode: false });
    // Developer keeps the caller's word.
    expect(
      composeConfigSnapshot("developer", PROVIDER_IDS.codex, { planMode: true }),
    ).toEqual({ planMode: true });
  });

  it("keeps a claude/copilot row left in plan out of a work run with no payload", () => {
    // Same leak, other providers: plan is a permissionMode there, and the
    // renderer sends no snapshot, so work's acceptEdits default must be what
    // reaches the driver — the provider row's "plan" never enters the merge.
    for (const providerId of [PROVIDER_IDS.claude, PROVIDER_IDS.copilot]) {
      expect(composeConfigSnapshot("work", providerId)).toEqual({
        permissionMode: "acceptEdits",
      });
      expect(composeConfigSnapshot("chat", providerId)).toEqual({
        permissionMode: "default",
      });
    }
  });
});

describe("composeToolPolicy", () => {
  it("keeps chat read-only when the caller asks for provider defaults", () => {
    expect(
      composeToolPolicy("chat", {
        allowedTools: null,
        disallowedTools: [],
      }),
    ).toEqual(MODE_HARNESSES.chat.toolPolicy);
  });

  it("lets the caller narrow chat but never widen it", () => {
    expect(
      composeToolPolicy("chat", {
        allowedTools: ["Read", "Bash"],
        disallowedTools: ["WebSearch"],
      }),
    ).toEqual({
      allowedTools: ["Read"],
      disallowedTools: [
        "Bash",
        "Write",
        "Edit",
        "MultiEdit",
        "NotebookEdit",
        "Task",
        "WebSearch",
      ],
    });
  });

  it("unions work's hard denials with the caller's denials", () => {
    expect(
      composeToolPolicy("work", {
        allowedTools: ["Bash", "Read"],
        disallowedTools: ["Write"],
      }),
    ).toEqual({
      allowedTools: ["Bash", "Read"],
      disallowedTools: ["Bash", "Write"],
    });
  });

  it("passes a restrictive caller policy through developer mode", () => {
    expect(
      composeToolPolicy("developer", {
        allowedTools: ["Read"],
        disallowedTools: ["Bash"],
      }),
    ).toEqual({ allowedTools: ["Read"], disallowedTools: ["Bash"] });
  });

  it("rejects malformed snapshots at the composition seam", () => {
    expect(() =>
      composeToolPolicy("chat", {
        allowedTools: "everything",
        disallowedTools: [],
      }),
    ).toThrow("Invalid tool policy allowedTools");
    expect(() =>
      composeToolPolicy("chat", {
        allowedTools: null,
        disallowedTools: ["Bash", 42],
      }),
    ).toThrow("Invalid tool policy disallowedTools");
  });
});

describe("modeProviderSetting", () => {
  it("reports the value a mode pins for a provider", () => {
    expect(modeProviderSetting("work", PROVIDER_IDS.codex, "personality")).toBe(
      "friendly",
    );
    expect(modeProviderSetting("chat", PROVIDER_IDS.codex, "sandboxMode")).toBe(
      "read-only",
    );
  });

  it("returns undefined when the mode leaves the setting alone", () => {
    // What a settings UI keys off: developer pins nothing, so its controls
    // stay controls.
    expect(
      modeProviderSetting("developer", PROVIDER_IDS.codex, "personality"),
    ).toBeUndefined();
    expect(
      modeProviderSetting("work", PROVIDER_IDS.codex, "webSearchMode"),
    ).toBeUndefined();
    expect(
      modeProviderSetting("work", PROVIDER_IDS.cursor, "personality"),
    ).toBeUndefined();
  });

  it("prefers an override over a default", () => {
    // chat pins the sandbox as an override; nothing may talk it down.
    expect(modeProviderSetting("chat", PROVIDER_IDS.codex, "sandboxMode")).toBe(
      MODE_HARNESSES.chat.configOverrides[PROVIDER_IDS.codex]?.sandboxMode,
    );
  });
});
