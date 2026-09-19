// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  delete (window as any).mainTransport;
  vi.resetModules();
});

describe("Settings sections", () => {
  it("gives Lens its own desktop Settings page", async () => {
    Object.defineProperty(window, "mainTransport", {
      configurable: true,
      value: {},
    });
    vi.resetModules();

    const { SETTINGS_MAIN_NAV_ITEMS, getSettingsSection } = await import(
      "./settings-sections"
    );

    expect(SETTINGS_MAIN_NAV_ITEMS.map((item) => item.id)).toContain("lens");
    expect(getSettingsSection("lens").label).toBe("Lens");
    expect(SETTINGS_MAIN_NAV_ITEMS.map((item) => item.id)).toContain(
      "shortcuts",
    );
    expect(getSettingsSection("shortcuts").label).toBe("Keyboard Shortcuts");
    expect(SETTINGS_MAIN_NAV_ITEMS.map((item) => item.id)).toContain(
      "notifications",
    );
    expect(getSettingsSection("notifications").label).toBe("Notifications");
  });

  it("keeps the local-only Lens page out of web navigation", async () => {
    vi.resetModules();
    const { SETTINGS_MAIN_NAV_ITEMS } = await import("./settings-sections");

    expect(SETTINGS_MAIN_NAV_ITEMS.map((item) => item.id)).not.toContain(
      "lens",
    );
    expect(SETTINGS_MAIN_NAV_ITEMS.map((item) => item.id)).not.toContain(
      "shortcuts",
    );
    expect(SETTINGS_MAIN_NAV_ITEMS.map((item) => item.id)).not.toContain(
      "notifications",
    );
  });
});
