// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capabilities: { windowChrome: true },
  setOnboardingWindow: vi.fn(),
}));
vi.mock("./platform/capabilities", () => ({ capabilities: mocks.capabilities }));

import { announceOnboardingStartup } from "./onboarding-startup";

beforeEach(() => {
  mocks.capabilities.windowChrome = true;
  mocks.setOnboardingWindow.mockReset().mockResolvedValue({ success: true, data: null });
  localStorage.clear();
  vi.stubGlobal("api", { app: { setOnboardingWindow: mocks.setOnboardingWindow } });
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("onboarding startup announcement", () => {
  it.each([undefined, "false"])("keeps first-run and unfinished onboarding compact: %s", async (completed) => {
    if (completed !== undefined) localStorage.setItem("persist:appSettings", JSON.stringify({ onboardingCompleted: completed }));
    await announceOnboardingStartup();
    expect(mocks.setOnboardingWindow).toHaveBeenCalledWith(true, false);
  });

  it("permits a splash only when this origin has persisted completed onboarding", async () => {
    localStorage.setItem("persist:appSettings", JSON.stringify({ onboardingCompleted: "true" }));
    await announceOnboardingStartup();
    expect(mocks.setOnboardingWindow).toHaveBeenCalledWith(false, false);
  });

  it.each(["{broken", "null", '{"onboardingCompleted":true}', JSON.stringify({ onboardingCompleted: JSON.stringify("true") })])(
    "keeps invalid stored state from permitting a splash: %s",
    async (raw) => {
      localStorage.setItem("persist:appSettings", raw);
      await announceOnboardingStartup();
      expect(mocks.setOnboardingWindow).toHaveBeenCalledWith(true, false);
    },
  );

  it("does not call the native presentation IPC from a web client", async () => {
    mocks.capabilities.windowChrome = false;
    await announceOnboardingStartup();
    expect(mocks.setOnboardingWindow).not.toHaveBeenCalled();
  });

  it("leaves boot running when the native announcement fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.setOnboardingWindow.mockRejectedValueOnce(new Error("connection closed"));
    await expect(announceOnboardingStartup()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledOnce();
  });
});
