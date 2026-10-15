// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAppTheme, DEFAULT_APP_THEME_SETTINGS, themeFrameColor } from "./app-themes";

const mocks = vi.hoisted(() => ({ capabilities: { windowsWindowChrome: true }, update: vi.fn() }));
vi.mock("./platform/capabilities", () => ({ capabilities: mocks.capabilities }));

beforeEach(() => {
  vi.resetModules();
  mocks.capabilities.windowsWindowChrome = true;
  mocks.update.mockReset().mockResolvedValue({ success: true, data: null });
  vi.stubGlobal("api", { app: { setWindowAppearance: mocks.update } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("renderer window appearance", () => {
  it("sends both effective appearances and applies provider/toggle changes", async () => {
    const { syncWindowAppearance } = await import("./window-appearance");
    const theme = resolveAppTheme({
      light: { theme: "absolutely", accent: "theme", translucent: false },
      dark: { theme: "tokyo-night", accent: "theme", translucent: true },
    });
    syncWindowAppearance(theme);
    expect(mocks.update).toHaveBeenLastCalledWith({
      light: { translucent: false, backgroundColor: themeFrameColor(theme.light, "light") },
      dark: { translucent: true, backgroundColor: themeFrameColor(theme.dark, "dark") },
    });
    syncWindowAppearance(theme);
    expect(mocks.update).toHaveBeenCalledOnce();
    syncWindowAppearance(resolveAppTheme(DEFAULT_APP_THEME_SETTINGS.default));
    expect(mocks.update).toHaveBeenLastCalledWith({
      light: { translucent: false, backgroundColor: "#f7f7f6" },
      dark: { translucent: false, backgroundColor: "#141414" },
    });
  });

  it("does not send Acrylic requests from macOS or web", async () => {
    mocks.capabilities.windowsWindowChrome = false;
    const { syncWindowAppearance } = await import("./window-appearance");
    syncWindowAppearance(resolveAppTheme(DEFAULT_APP_THEME_SETTINGS.default));
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("retries a rejected native update", async () => {
    const { syncWindowAppearance } = await import("./window-appearance");
    const theme = resolveAppTheme(DEFAULT_APP_THEME_SETTINGS.default);
    mocks.update.mockResolvedValueOnce({ success: false, error: "Window not ready" });
    syncWindowAppearance(theme);
    await Promise.resolve();
    syncWindowAppearance(theme);
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });
});
