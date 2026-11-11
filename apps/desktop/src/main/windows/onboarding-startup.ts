import { closeSplashWindow, createSplashWindow } from "./splashWindow";
import { createWindowStartupLifecycle } from "../../shared/window-lifecycle";

/** Never use a previous launch's hint: renderer storage is scoped to its origin. */
export function createOnboardingStartupState(showSplash = false) {
  const lifecycle = createWindowStartupLifecycle(showSplash);
  return {
    needsOnboarding: lifecycle.needsOnboarding,
    update(next: boolean, ready: boolean): boolean {
      const transition = lifecycle.update(next, ready);
      if (transition.showSplash) createSplashWindow();
      return transition.accepted;
    },
    finish() {
      // Mounted React content can precede ready-to-show or native bounds
      // restoration. Keep the splash until the window's actual handoff.
      if (lifecycle.finish()) closeSplashWindow();
    },
  };
}
