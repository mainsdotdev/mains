import { describe, it, expect } from "vitest";
import { resolveEffortSelection } from "./resolve-effort";

const LEVELS = ["low", "medium", "high"];

/** Defaults matching a Claude-shaped variant; each test overrides what it means to exercise. */
function input(overrides: Partial<Parameters<typeof resolveEffortSelection>[0]> = {}) {
  return {
    supportedEffortLevels: LEVELS,
    effortLevel: "medium",
    ultracode: false,
    thinkingDisabled: false,
    effortDefault: "medium",
    ...overrides,
  };
}

describe("resolveEffortSelection", () => {
  it("leaves a supported level alone", () => {
    expect(resolveEffortSelection(input())).toBeNull();
  });

  it("seeds the default when nothing is stored", () => {
    expect(resolveEffortSelection(input({ effortLevel: "" }))).toEqual({
      effortLevel: "medium",
    });
  });

  it("clamps the default onto what the model offers", () => {
    // "medium" is unavailable, so the seed lands on the nearest level offered
    // rather than jumping to the most expensive one.
    expect(
      resolveEffortSelection(
        input({ effortLevel: "", supportedEffortLevels: ["high", "xhigh"] }),
      ),
    ).toEqual({ effortLevel: "high" });
  });

  it("clamps an unsupported stored level to the highest offered", () => {
    expect(
      resolveEffortSelection(
        input({ effortLevel: "xhigh", supportedEffortLevels: LEVELS }),
      ),
    ).toEqual({ effortLevel: "high" });
  });

  it("clears the level when the model offers none", () => {
    expect(
      resolveEffortSelection(input({ supportedEffortLevels: [] })),
    ).toEqual({ effortLevel: "" });
  });

  it("leaves an already-empty level alone when the model offers none", () => {
    expect(
      resolveEffortSelection(
        input({ effortLevel: "", supportedEffortLevels: undefined }),
      ),
    ).toBeNull();
  });

  // ── Explicit "Off" ──
  // The regression this module exists for: turning reasoning off stores no
  // level, and the seed used to read that as "never configured" and write the
  // default straight back — so Off was unselectable and every run paid for
  // reasoning it was told not to do.
  describe("when the user has turned reasoning off", () => {
    it("does not seed the default back", () => {
      expect(
        resolveEffortSelection(
          input({ effortLevel: "", thinkingDisabled: true }),
        ),
      ).toBeNull();
    });

    it("still clamps a stored level the model cannot serve", () => {
      expect(
        resolveEffortSelection(
          input({ effortLevel: "xhigh", thinkingDisabled: true }),
        ),
      ).toEqual({ effortLevel: "high" });
    });

    it("still clears a stale level when the model offers none", () => {
      expect(
        resolveEffortSelection(
          input({ supportedEffortLevels: [], thinkingDisabled: true }),
        ),
      ).toEqual({ effortLevel: "" });
    });
  });

  // ── ultracode (Claude) ──
  describe("ultracode", () => {
    it("leaves it alone on a model that supports xhigh", () => {
      expect(
        resolveEffortSelection(
          input({
            ultracode: true,
            effortLevel: "ultracode",
            supportedEffortLevels: ["medium", "high", "xhigh"],
          }),
        ),
      ).toBeNull();
    });

    it("falls back to the highest level on a model without xhigh", () => {
      expect(
        resolveEffortSelection(
          input({ ultracode: true, effortLevel: "ultracode" }),
        ),
      ).toEqual({ effortLevel: "high" });
    });

    it("falls back to Off on a model with no levels at all", () => {
      expect(
        resolveEffortSelection(
          input({
            ultracode: true,
            effortLevel: "ultracode",
            supportedEffortLevels: [],
          }),
        ),
      ).toEqual({ effortLevel: "" });
    });

    it("wins over an explicit off — the flag is its own opt-in", () => {
      expect(
        resolveEffortSelection(
          input({
            ultracode: true,
            effortLevel: "ultracode",
            supportedEffortLevels: ["medium", "high", "xhigh"],
            thinkingDisabled: true,
          }),
        ),
      ).toBeNull();
    });
  });
});
