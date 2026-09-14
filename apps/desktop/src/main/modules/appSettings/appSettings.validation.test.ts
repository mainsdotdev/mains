import { describe, it, expect } from "vitest";
import { sanitizeAppSettingsPatch } from "./appSettings.validation";

describe("sanitizeAppSettingsPatch", () => {
  it("returns null for non-objects", () => {
    expect(sanitizeAppSettingsPatch(null)).toBeNull();
    expect(sanitizeAppSettingsPatch(undefined)).toBeNull();
    expect(sanitizeAppSettingsPatch("string")).toBeNull();
    expect(sanitizeAppSettingsPatch(42)).toBeNull();
    expect(sanitizeAppSettingsPatch(true)).toBeNull();
  });

  it("keeps all mutable fields", () => {
    const patch = {
      activeSpaceId: "s1",
      enableWorktrees: true,
      showToolCalls: false,
      preventSleepDuringRuns: true,
      notifyOnRunComplete: false,
      notifyOnToolApproval: true,
      showMenuBarIcon: false,
      commitInstructions: "use conventional commits",
      prInstructions: "include a test plan",
    };
    expect(sanitizeAppSettingsPatch(patch)).toEqual(patch);
  });

  it("strips unknown keys", () => {
    const result = sanitizeAppSettingsPatch({
      enableWorktrees: false,
      somethingMadeUp: "hi",
    });
    expect(result).toEqual({ enableWorktrees: false });
  });

  it("strips immutable fields (id, accountId, createdAt, updatedAt)", () => {
    const result = sanitizeAppSettingsPatch({
      id: "hacked",
      accountId: "hacked",
      createdAt: 0,
      updatedAt: 0,
      enableWorktrees: false,
    });
    expect(result).toEqual({ enableWorktrees: false });
  });

  it("preserves null for activeSpaceId", () => {
    expect(sanitizeAppSettingsPatch({ activeSpaceId: null })).toEqual({
      activeSpaceId: null,
    });
  });

  it("returns an empty patch for an empty object", () => {
    expect(sanitizeAppSettingsPatch({})).toEqual({});
  });
});
