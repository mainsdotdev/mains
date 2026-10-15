import { closeSplashWindow, createSplashWindow } from "./splashWindow";

/** Never use a previous launch's hint: renderer storage is scoped to its origin. */
export function createOnboardingStartupState(showSplash = false) {
  let onboarding = true;
  let contentReady = false;
  let splashRequested = false;

  return {
    needsOnboarding: () => onboarding,
    update(next: boolean, ready: boolean): boolean {
      // A late boot announcement must not undo the mounted UI's decision.
      if (contentReady && !ready) return false;
      onboarding = next;
      if (ready) contentReady = true;
      if (!next && !ready && showSplash && !splashRequested) {
        splashRequested = true;
        createSplashWindow();
      }
      return true;
    },
    finish() {
      contentReady = true;
      // Mounted React content can precede ready-to-show or native bounds
      // restoration. Keep the splash until the window's actual handoff.
      closeSplashWindow();
    },
  };
}
