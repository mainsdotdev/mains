import { useLayoutEffect } from "react";
import { useCapabilities } from "@/lib/platform";

/** App owns this effect so finishing the flow restores the workspace window. */
export function useOnboardingWindow(onboarding: boolean, enabled = true): void {
  const { windowChrome } = useCapabilities();
  useLayoutEffect(() => {
    if (!enabled || !windowChrome || !window.api?.app?.setOnboardingWindow) return;
    void window.api.app.setOnboardingWindow(onboarding).catch((error) => {
      console.error("Unable to update onboarding window", error);
    });
    // No cleanup: StrictMode and renderer reloads must keep the native snapshot.
  }, [onboarding, enabled, windowChrome]);
}
