import { flushSync } from "react-dom";

/** Fade the card before the native window expands to its workspace bounds. */
export async function prepareWorkspaceWindow(
  frame: HTMLElement | null,
  nativeWindow: boolean,
  reducedMotion: boolean,
): Promise<void> {
  let animation: Animation | undefined;
  try {
    if (frame?.animate) {
      animation = frame.animate(
        reducedMotion
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [
              { opacity: 1, transform: "scale(1)" },
              { opacity: 0, transform: "scale(0.985)" },
            ],
        { duration: reducedMotion ? 100 : 180, easing: "ease-out", fill: "forwards" },
      );
      await animation.finished;
    }
    if (nativeWindow && window.api?.app?.setOnboardingWindow) {
      const result = await window.api.app.setOnboardingWindow(false);
      if (!result.success) throw new Error(result.error);
    }
  } catch (error) {
    animation?.cancel();
    throw error;
  }
}

/** Keep the expanded gradient visible until the workspace has painted. */
export function revealOnboardingWorkspace(commit: () => void): void {
  if (typeof document.startViewTransition !== "function") {
    commit();
    return;
  }
  document.documentElement.setAttribute("data-onboarding-transition", "");
  try {
    const transition = document.startViewTransition(() => flushSync(commit));
    void transition.finished.catch(() => {}).finally(() => {
      document.documentElement.removeAttribute("data-onboarding-transition");
    });
  } catch {
    document.documentElement.removeAttribute("data-onboarding-transition");
    commit();
  }
}
