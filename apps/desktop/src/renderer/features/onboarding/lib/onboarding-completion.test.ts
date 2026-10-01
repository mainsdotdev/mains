// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareWorkspaceWindow, revealOnboardingWorkspace } from "./onboarding-completion";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "startViewTransition");
  document.documentElement.removeAttribute("data-onboarding-transition");
});

describe("onboarding completion presentation", () => {
  it("waits for both the card fade and native resize before exposing the workspace", async () => {
    const fade = deferred<void>();
    const resize = deferred<{ success: true; data: null }>();
    const setOnboardingWindow = vi.fn(() => resize.promise);
    vi.stubGlobal("api", { app: { setOnboardingWindow } });
    const frame = document.createElement("section");
    Object.defineProperty(frame, "animate", {
      value: vi.fn(() => ({ finished: fade.promise, cancel: vi.fn() })),
    });
    const completed = vi.fn();
    const preparation = prepareWorkspaceWindow(frame, true, false).then(completed);
    expect(setOnboardingWindow).not.toHaveBeenCalled();
    fade.resolve();
    await vi.waitFor(() => expect(setOnboardingWindow).toHaveBeenCalledWith(false));
    expect(completed).not.toHaveBeenCalled();
    resize.resolve({ success: true, data: null });
    await preparation;
    expect(completed).toHaveBeenCalledOnce();
  });

  it("restores the card when the native window request fails", async () => {
    vi.stubGlobal("api", {
      app: { setOnboardingWindow: vi.fn().mockResolvedValue({ success: false, error: "Unavailable" }) },
    });
    const cancel = vi.fn();
    const frame = document.createElement("section");
    Object.defineProperty(frame, "animate", {
      value: vi.fn(() => ({ finished: Promise.resolve(), cancel })),
    });
    await expect(prepareWorkspaceWindow(frame, true, false)).rejects.toThrow("Unavailable");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("uses an opacity-only fade for reduced motion and leaves web windows alone", async () => {
    const setOnboardingWindow = vi.fn();
    vi.stubGlobal("api", { app: { setOnboardingWindow } });
    const frame = document.createElement("section");
    const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => ({
      finished: Promise.resolve(), cancel: vi.fn(),
    }));
    Object.defineProperty(frame, "animate", { value: animate });
    await prepareWorkspaceWindow(frame, false, true);
    expect(animate.mock.calls[0]?.[0]).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(setOnboardingWindow).not.toHaveBeenCalled();
  });

  it("keeps the snapshot transition active until the workspace has appeared", async () => {
    const finished = deferred<void>();
    const start = vi.fn((update: () => void) => {
      update();
      return { finished: finished.promise };
    });
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
    const commit = vi.fn();
    revealOnboardingWorkspace(commit);
    expect(commit).toHaveBeenCalledOnce();
    expect(document.documentElement.hasAttribute("data-onboarding-transition")).toBe(true);
    finished.resolve();
    await vi.waitFor(() =>
      expect(document.documentElement.hasAttribute("data-onboarding-transition")).toBe(false),
    );
  });

  it("still commits when snapshot transitions are unavailable or fail to start", () => {
    const commit = vi.fn();
    revealOnboardingWorkspace(commit);
    expect(commit).toHaveBeenCalledOnce();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: () => { throw new Error("Transition unavailable"); },
    });
    revealOnboardingWorkspace(commit);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(document.documentElement.hasAttribute("data-onboarding-transition")).toBe(false);
  });
});
