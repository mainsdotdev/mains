import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createSplashWindow: vi.fn(), closeSplashWindow: vi.fn() }));
vi.mock("./splashWindow", () => mocks);

import { createOnboardingStartupState } from "./onboarding-startup";

beforeEach(() => vi.clearAllMocks());

describe("onboarding startup presentation", () => {
  it("does not authorize a splash from a previous launch before the current renderer confirms completion", () => {
    const startup = createOnboardingStartupState(true);
    expect(startup.needsOnboarding()).toBe(true);
    expect(mocks.createSplashWindow).not.toHaveBeenCalled();
    startup.update(true, false);
    startup.update(true, true);
    expect(mocks.createSplashWindow).not.toHaveBeenCalled();
  });

  it("allows one splash only after the current renderer confirms completed onboarding", () => {
    const startup = createOnboardingStartupState(true);
    startup.update(false, false);
    startup.update(false, false);
    expect(mocks.createSplashWindow).toHaveBeenCalledOnce();
    expect(startup.needsOnboarding()).toBe(false);
    startup.update(false, true);
    expect(mocks.closeSplashWindow).toHaveBeenCalledOnce();
  });

  it("closes a splash if rehydration decides onboarding must run", () => {
    const startup = createOnboardingStartupState(true);
    startup.update(false, false);
    startup.update(true, true);
    expect(mocks.closeSplashWindow).toHaveBeenCalledOnce();
    expect(startup.needsOnboarding()).toBe(true);
  });

  it("ignores late boot announcements after content has become ready", () => {
    const startup = createOnboardingStartupState(true);
    startup.update(true, true);
    expect(startup.update(false, false)).toBe(false);
    expect(startup.needsOnboarding()).toBe(true);
    expect(mocks.createSplashWindow).not.toHaveBeenCalled();
  });

  it("never opens a splash when finishing onboarding or reopening a window", () => {
    const startup = createOnboardingStartupState();
    startup.update(false, false);
    startup.update(true, true);
    startup.update(false, true);
    expect(mocks.createSplashWindow).not.toHaveBeenCalled();
  });

  it("cancels a pending splash when the window closes or the readiness fallback fires", () => {
    const startup = createOnboardingStartupState(true);
    startup.update(false, false);
    startup.finish();
    startup.update(false, false);
    expect(mocks.createSplashWindow).toHaveBeenCalledOnce();
    expect(mocks.closeSplashWindow).toHaveBeenCalledOnce();
  });
});
