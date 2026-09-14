// ─────────────────────────────────────────────────────────────
// Table-invariant tests for the mode-config descriptor — the UI
// half of a mode; the sibling of provider-variants.test.ts.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { MODE_IDS, DEFAULT_MODE_ID } from "../../shared/modes";
import { MODE_CONFIGS, getModeConfig } from "./mode-config";

describe("MODE_CONFIGS table invariants", () => {
  it("presents the internal developer mode as Code", () => {
    expect(MODE_CONFIGS.developer.label).toBe("Code");
  });

  it("has an entry for every mode id, keyed consistently", () => {
    for (const mode of MODE_IDS) {
      expect(MODE_CONFIGS[mode]).toBeDefined();
      expect(MODE_CONFIGS[mode].mode).toBe(mode);
      expect(MODE_CONFIGS[mode].label.length).toBeGreaterThan(0);
    }
  });

  it("locks developer to the full surface — every flag true", () => {
    const dev = MODE_CONFIGS.developer;
    expect(dev.showGitActions).toBe(true);
    expect(dev.showTerminal).toBe(true);
    expect(dev.showChangesTab).toBe(true);
    expect(dev.showPermissionControls).toBe(true);
    expect(dev.showPlanControls).toBe(true);
    expect(dev.showGoalControls).toBe(true);
    expect(dev.showTasksNav).toBe(true);
    expect(dev.showTabs).toBe(true);
    expect(dev.showRightPanel).toBe(true);
  });

  it("locks developer's sidebar shape — the pixel-identity tripwire", () => {
    expect(MODE_CONFIGS.developer.sidebar).toEqual({
      title: "Project",
      itemType: "workspace",
      actionPrefix: "Add",
      defaultRoute: "/code",
    });
  });

  it("hides the git ceremony in work and chat", () => {
    for (const mode of ["work", "chat"] as const) {
      expect(MODE_CONFIGS[mode].showGitActions).toBe(false);
      expect(MODE_CONFIGS[mode].showTerminal).toBe(false);
      expect(MODE_CONFIGS[mode].showChangesTab).toBe(false);
      expect(MODE_CONFIGS[mode].showPermissionControls).toBe(false);
    }
  });

  it("gives work and chat the ChatGPT-style shell", () => {
    for (const mode of ["work", "chat"] as const) {
      expect(MODE_CONFIGS[mode].showTasksNav).toBe(false);
      expect(MODE_CONFIGS[mode].showTabs).toBe(false);
      expect(MODE_CONFIGS[mode].showRightPanel).toBe(false);
      expect(MODE_CONFIGS[mode].sidebar.itemType).toBe("chat");
      expect(MODE_CONFIGS[mode].sidebar.actionPrefix).toBe("New");
      expect(MODE_CONFIGS[mode].sidebar.title).toBe("chat");
    }
  });

  it("advertises files in the composer only where the agent edits them", () => {
    for (const mode of MODE_IDS) {
      const ph = MODE_CONFIGS[mode].composerPlaceholder;
      expect(ph.initial.length).toBeGreaterThan(0);
      expect(ph.followUp.length).toBeGreaterThan(0);
      expect(/files/.test(ph.initial)).toBe(mode === "developer");
      expect(/files/.test(ph.followUp)).toBe(mode === "developer");
    }
  });

  it("shows the plugins picker only in work", () => {
    expect(MODE_CONFIGS.developer.showPluginsButton).toBe(false);
    expect(MODE_CONFIGS.work.showPluginsButton).toBe(true);
    expect(MODE_CONFIGS.chat.showPluginsButton).toBe(false);
  });

  it("keeps chat free of every composer mode control", () => {
    expect(MODE_CONFIGS.chat.showPlanControls).toBe(false);
    expect(MODE_CONFIGS.chat.showGoalControls).toBe(false);
  });

  it("hides plan controls outside developer, matching the harness pin", () => {
    // The composer gates the plan row on this flag (it lives inside the
    // permission dropdown, so the permission flag alone does not cover it),
    // and the harness pins codex planMode off for the same two modes.
    expect(MODE_CONFIGS.developer.showPlanControls).toBe(true);
    expect(MODE_CONFIGS.work.showPlanControls).toBe(false);
    expect(MODE_CONFIGS.chat.showPlanControls).toBe(false);
  });
});

describe("getModeConfig", () => {
  it("resolves valid ids", () => {
    for (const mode of MODE_IDS) {
      expect(getModeConfig(mode)).toBe(MODE_CONFIGS[mode]);
    }
  });

  it("falls back to the default mode for unknown or absent values", () => {
    expect(getModeConfig(null)).toBe(MODE_CONFIGS[DEFAULT_MODE_ID]);
    expect(getModeConfig(undefined)).toBe(MODE_CONFIGS[DEFAULT_MODE_ID]);
    expect(getModeConfig("gaming")).toBe(MODE_CONFIGS[DEFAULT_MODE_ID]);
  });
});
