import { describe, it, expect } from "vitest";
import { PROVIDER_IDS } from "./provider-ids";
import {
  MODE_IDS,
  PROVIDER_MODES,
  clampModeForProvider,
  providerModes,
  providerSupportsMode,
} from "./modes";

describe("PROVIDER_MODES", () => {
  it("covers every provider", () => {
    for (const id of Object.values(PROVIDER_IDS)) {
      expect(PROVIDER_MODES[id]).toBeDefined();
      expect(PROVIDER_MODES[id].length).toBeGreaterThan(0);
    }
  });

  it("lists only known mode ids", () => {
    for (const modes of Object.values(PROVIDER_MODES)) {
      for (const mode of modes) expect(MODE_IDS).toContain(mode);
    }
  });

  it("keeps developer available everywhere — no provider can be unreachable", () => {
    for (const id of Object.values(PROVIDER_IDS)) {
      expect(PROVIDER_MODES[id]).toContain("developer");
    }
  });

  it("gives work and chat to claude and codex only, for now", () => {
    expect(providerSupportsMode(PROVIDER_IDS.claude, "work")).toBe(true);
    expect(providerSupportsMode(PROVIDER_IDS.codex, "chat")).toBe(true);
    expect(providerSupportsMode(PROVIDER_IDS.copilot, "work")).toBe(false);
    expect(providerSupportsMode(PROVIDER_IDS.cursor, "chat")).toBe(false);
  });

  it("leaves an unknown provider id unrestricted", () => {
    expect(providerModes("some_future_agent")).toEqual(MODE_IDS);
  });
});

describe("clampModeForProvider", () => {
  it("passes a supported mode through", () => {
    expect(clampModeForProvider(PROVIDER_IDS.claude, "chat")).toBe("chat");
  });

  it("falls back to developer for a mode the provider dropped", () => {
    // The read path for a space row written while the provider still had it.
    expect(clampModeForProvider(PROVIDER_IDS.copilot, "chat")).toBe("developer");
    expect(clampModeForProvider(PROVIDER_IDS.cursor, "work")).toBe("developer");
  });

  it("falls back for a null or unknown stored value", () => {
    expect(clampModeForProvider(PROVIDER_IDS.claude, null)).toBe("developer");
    expect(clampModeForProvider(PROVIDER_IDS.claude, "legacy" as never)).toBe(
      "developer",
    );
  });
});
