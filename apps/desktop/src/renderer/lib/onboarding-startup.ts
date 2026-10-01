import { capabilities } from "./platform/capabilities";
import { readPersistedAppSetting } from "./redux/persist-boot";

/** Announce this origin's persisted flag before loading the React app graph. */
export async function announceOnboardingStartup(): Promise<void> {
  if (!capabilities.windowChrome || !window.api?.app?.setOnboardingWindow) return;
  const completed = readPersistedAppSetting(
    "onboardingCompleted",
    (value): value is boolean => typeof value === "boolean",
    false,
  );
  try {
    const result = await window.api.app.setOnboardingWindow(!completed, false);
    if (!result.success) throw new Error(result.error);
  } catch (error) {
    // A failed announcement must not prevent the mounted app from recovering.
    console.error("Unable to announce onboarding startup", error);
  }
}
